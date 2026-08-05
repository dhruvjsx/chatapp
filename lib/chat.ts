import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

export type MessageRole = "user" | "assistant";
export type MessageStatus = "pending" | "streaming" | "complete" | "error";

export type Conversation = {
  id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
};

export type Message = {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  status: MessageStatus;
  created_at: string;
  updated_at: string;
};

export async function createConversation(title?: string): Promise<Conversation> {
  const { data, error } = await supabase
    .from("conversations")
    .insert({ title: title ?? null })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function fetchLatestConversation(): Promise<Conversation | null> {
  const { data, error } = await supabase
    .from("conversations")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) throw error;
  return data[0] ?? null;
}

/**
 * Fetches the most recent `limit` messages, oldest first (ready to render
 * directly). Paginated rather than loading the whole conversation so the
 * initial load stays cheap no matter how long the history has grown — see
 * fetchOlderMessages for backfilling earlier history on scroll-up.
 */
export async function fetchRecentMessages(conversationId: string, limit: number): Promise<Message[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data.reverse();
}

/**
 * Fetches up to `limit` messages older than `beforeCreatedAt`, oldest first,
 * for prepending to an already-loaded page. Cursors on created_at rather
 * than an offset so a page boundary doesn't shift under concurrent inserts.
 * Known gap: two messages inserted in the same millisecond would tie on the
 * cursor — acceptable here since timestamps are server-generated per row.
 */
export async function fetchOlderMessages(
  conversationId: string,
  beforeCreatedAt: string,
  limit: number
): Promise<Message[]> {
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("conversation_id", conversationId)
    .lt("created_at", beforeCreatedAt)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data.reverse();
}

/**
 * Upserts by the message's client-generated id. This is the one write path
 * for: sending a new message, patching an assistant reply's content on every
 * streamed chunk, and retrying a queued offline send — the same id means a
 * retry after reconnect overwrites itself instead of duplicating the row.
 */
export async function upsertMessage(message: {
  id: string;
  conversation_id: string;
  role: MessageRole;
  content: string;
  status?: MessageStatus;
}): Promise<void> {
  const { error } = await supabase
    .from("messages")
    .upsert({ status: "complete", ...message }, { onConflict: "id" });

  if (error) throw error;
}

export function subscribeToMessages(
  conversationId: string,
  onChange: (message: Message) => void
): RealtimeChannel {
  return supabase
    .channel(`messages-${conversationId}`)
    .on(
      "postgres_changes",
      {
        event: "*",
        schema: "public",
        table: "messages",
        filter: `conversation_id=eq.${conversationId}`,
      },
      (payload) => onChange(payload.new as Message)
    )
    .subscribe();
}
