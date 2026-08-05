import {
    createConversation,
    fetchLatestConversation,
    fetchMessages,
    subscribeToMessages,
    upsertMessage,
    type Message,
} from "@/lib/chat";
import { streamChatCompletion, type ChatMessage } from "@/lib/openrouter";
import { generateId } from "@/utils/id";
import { SYNC_EVERY_N_TICKS, UI_FLUSH_MS } from "@/constants/chat";
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
  error: string | null;
  init: () => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
};

export const useChatStore = create<ChatState>((set, get) => ({
  conversationId: null,
  messages: [],
  isStreaming: false,
  error: null,

  init: async () => {
    if (get().conversationId) return;

    try {
      const conversation = (await fetchLatestConversation()) ?? (await createConversation("Relay chat"));
      const messages = await fetchMessages(conversation.id);
      set({ conversationId: conversation.id, messages });

      realtimeChannel?.unsubscribe();
      realtimeChannel = subscribeToMessages(conversation.id, (message) => {
        set((state) => ({ messages: mergeMessage(state.messages, message) }));
      });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Failed to load conversation." });
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
