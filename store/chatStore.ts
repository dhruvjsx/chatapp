import {
    createConversation,
    fetchLatestConversation,
    fetchOlderMessages,
    fetchRecentMessages,
    subscribeToMessages,
    upsertMessage,
    type Message,
} from "@/lib/chat";
import { streamChatCompletion, type ChatMessage } from "@/lib/openrouter";
import { generateId } from "@/utils/id";
import { MESSAGES_PAGE_SIZE, MIN_HISTORY_LOADER_MS, SYNC_EVERY_N_TICKS, UI_FLUSH_MS } from "@/constants/chat";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { create } from "zustand";

let realtimeChannel: RealtimeChannel | null = null;

// Called for every Realtime row, regardless of whether *this* device is
// mid-stream on some other message right now — see the "message arrives
// mid-stream" note on subscribeToMessages below for why merging is
// unconditional. This function only decides *where* an incoming row lands.
//
// An existing id is a content/status patch (this device's own streaming
// upsert echoing back, or another device patching its own message) — replace
// in place so array position, and thus scroll position, doesn't move.
//
// A new id is inserted in created_at order rather than always appended.
// In practice a brand-new row's server-assigned created_at is later than
// everything already loaded, so this is almost always equivalent to
// appending — but "almost always" isn't "always": the *locally optimistic*
// message this device is still streaming was timestamped off the client's
// own clock before the server had a say, so a new row from another client
// arriving mid-stream could sort earlier than it if that clock is skewed.
// Sorting here means a message from another client always renders in its
// correct chronological slot on first paint, not just after the echo of
// this device's own write corrects its timestamp a few hundred ms later.
function mergeMessage(messages: Message[], incoming: Message): Message[] {
  const index = messages.findIndex((m) => m.id === incoming.id);
  if (index !== -1) {
    const next = messages.slice();
    next[index] = incoming;
    return next;
  }

  const insertAt = messages.findIndex((m) => m.created_at > incoming.created_at);
  if (insertAt === -1) return [...messages, incoming];
  return [...messages.slice(0, insertAt), incoming, ...messages.slice(insertAt)];
}

type ChatState = {
  conversationId: string | null;
  messages: Message[];
  isStreaming: boolean;
  isLoadingOlder: boolean;
  hasMoreOlder: boolean;
  error: string | null;
  init: () => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  loadOlderMessages: () => Promise<void>;
};

export const useChatStore = create<ChatState>((set, get) => ({
  conversationId: null,
  messages: [],
  isStreaming: false,
  isLoadingOlder: false,
  hasMoreOlder: true,
  error: null,

  init: async () => {
    if (get().conversationId) return;

    try {
      const conversation = (await fetchLatestConversation()) ?? (await createConversation("Relay chat"));
      const messages = await fetchRecentMessages(conversation.id, MESSAGES_PAGE_SIZE);
      set({
        conversationId: conversation.id,
        messages,
        hasMoreOlder: messages.length === MESSAGES_PAGE_SIZE,
      });

      realtimeChannel?.unsubscribe();
      // Decision: interleave, not block or queue. A row from another client
      // (or another turn) merges in the instant it arrives, even while this
      // device's own isStreaming is true for a *different* message — the two
      // are independent turns, each keyed by its own id, so neither waits on
      // the other. Blocking until the local stream finishes would mean a
      // slow LLM reply on this device delays a message from another client
      // showing up at all, which defeats the ~1s real-time sync goal.
      // isStreaming only gates *this* device's own composer (see sendMessage
      // / app/index.tsx) — it has no bearing on what's rendered here, so two
      // streaming assistant bubbles (this device's own token-by-token one,
      // and another device's relayed via its own upsert cadence) can be on
      // screen at once. See ARCHITECTURE.md for the gap this doesn't cover:
      // nothing arbitrates *who* calls the LLM for a message from another
      // client.
      realtimeChannel = subscribeToMessages(conversation.id, (message) => {
        set((state) => ({ messages: mergeMessage(state.messages, message) }));
      });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Failed to load conversation." });
    }
  },

  // Triggered by onStartReached once the oldest loaded message scrolls into
  // view. Cursors on the oldest loaded message's created_at and prepends the
  // result — FlashList's maintainVisibleContentPosition (already enabled;
  // see app/index.tsx) keeps whatever the user is currently looking at
  // pinned in place while the new content is added above it.
  loadOlderMessages: async () => {
    const { conversationId, messages, isLoadingOlder, hasMoreOlder } = get();
    if (!conversationId || isLoadingOlder || !hasMoreOlder || messages.length === 0) return;

    set({ isLoadingOlder: true });
    const startedAt = Date.now();
    try {
      const older = await fetchOlderMessages(conversationId, messages[0].created_at, MESSAGES_PAGE_SIZE);

      // Hold the loader up to its floor before revealing the page, so the
      // loader and the new content swap in together instead of the content
      // popping in underneath a spinner that's still lingering above it.
      const remaining = MIN_HISTORY_LOADER_MS - (Date.now() - startedAt);
      if (remaining > 0) {
        await new Promise((resolve) => setTimeout(resolve, remaining));
      }

      set((state) => ({
        messages: [...older, ...state.messages],
        hasMoreOlder: older.length === MESSAGES_PAGE_SIZE,
        isLoadingOlder: false,
      }));
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to load older messages.",
        isLoadingOlder: false,
      });
    }
  },

  sendMessage: async (text: string) => {
    const trimmed = text.trim();
    const { conversationId, isStreaming, messages: history } = get();
    if (!trimmed || !conversationId || isStreaming) return;

    const now = new Date().toISOString();
    const userMessage: Message = {
      id: generateId(),
      conversation_id: conversationId,
      role: "user",
      content: trimmed,
      status: "complete",
      created_at: now,
      updated_at: now,
    };
    const assistantId = generateId();
    const assistantMessage: Message = {
      id: assistantId,
      conversation_id: conversationId,
      role: "assistant",
      content: "",
      status: "streaming",
      created_at: now,
      updated_at: now,
    };

    set((state) => ({
      messages: [...state.messages, userMessage, assistantMessage],
      isStreaming: true,
      error: null,
    }));

    upsertMessage(userMessage).catch((err) =>
      set({ error: err instanceof Error ? err.message : "Failed to send message." })
    );

    const apiHistory: ChatMessage[] = [...history, userMessage].map((m) => ({
      role: m.role,
      content: m.content,
    }));

    let assistantContent = "";
    let pendingDelta = "";
    let tick = 0;

    const flush = (status: "streaming" | "complete" | "error") => {
      const isFinal = status !== "streaming";
      if (!pendingDelta && !isFinal) return;

      assistantContent += pendingDelta;
      pendingDelta = "";
      tick += 1;

      set((state) => ({
        messages: state.messages.map((m) =>
          m.id === assistantId ? { ...m, content: assistantContent, status } : m
        ),
      }));

      if (isFinal || tick % SYNC_EVERY_N_TICKS === 0) {
        upsertMessage({
          id: assistantId,
          conversation_id: conversationId,
          role: "assistant",
          content: assistantContent,
          status,
        }).catch((err) => set({ error: err instanceof Error ? err.message : "Failed to sync reply." }));
      }
    };

    const timer = setInterval(() => flush("streaming"), UI_FLUSH_MS);

    streamChatCompletion(apiHistory, {
      onToken: (delta) => {
        pendingDelta += delta;
      },
      onComplete: () => {
        clearInterval(timer);
        flush("complete");
        set({ isStreaming: false });
      },
      onError: (err) => {
        clearInterval(timer);
        flush("error");
        set({ isStreaming: false, error: err.message });
      },
    });
  },
}));
