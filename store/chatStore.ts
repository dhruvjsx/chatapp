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

function mergeMessage(messages: Message[], incoming: Message): Message[] {
  const index = messages.findIndex((m) => m.id === incoming.id);
  if (index === -1) return [...messages, incoming];
  const next = messages.slice();
  next[index] = incoming;
  return next;
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
