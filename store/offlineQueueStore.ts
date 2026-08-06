import { upsertMessage } from "@/lib/chat";
import { storage } from "@/lib/storage";
import NetInfo from "@react-native-community/netinfo";
import { create } from "zustand";
import { createJSONStorage, persist, type StateStorage } from "zustand/middleware";

// zustand's persist middleware talks to a Storage interface (getItem/setItem/
// removeItem); MMKV's API is a synchronous string store. This adapter is
// nothing but that plumbing - no async work actually happens, so the queue
// is readable the instant this module evaluates, before first render.
const mmkvStorage: StateStorage = {
  getItem: (name) => storage.getString(name) ?? null,
  setItem: (name, value) => storage.set(name, value),
  removeItem: (name) => storage.delete(name),
};

export type QueuedMessageStatus = "pending" | "sent" | "failed";

export type QueuedMessage = {
  // Client-generated in chatStore.sendMessage *before* this message ever
  // reaches this queue (before any send is attempted at all). This id is the
  // entire dedupe strategy: it's the same id upsertMessage() writes as the
  // row's primary key (`onConflict: "id"` in lib/chat.ts, `id uuid primary
  // key` in the migration), so replaying a send with this id - whether the
  // retry is this device re-running flush() after being killed mid-flush, or
  // the row already landed from a previous attempt - always overwrites the
  // same row instead of inserting a second one. The client never asks the
  // backend "did this already send?" before retrying; it just always sends
  // with the same id and lets Postgres collapse the duplicate.
  id: string;
  conversationId: string;
  content: string;
  createdAt: string;
  status: QueuedMessageStatus;
};

type OfflineQueueState = {
  isOnline: boolean;
  queue: QueuedMessage[];
  isFlushing: boolean;
  // Starts the NetInfo listener. Call once, from app/_layout.tsx; returns
  // the unsubscribe function for cleanup.
  init: () => () => void;
  enqueue: (message: Omit<QueuedMessage, "status">) => void;
  flush: () => Promise<void>;
};

export const useOfflineQueueStore = create<OfflineQueueState>()(
  persist(
    (set, get) => ({
      isOnline: true,
      queue: [],
      isFlushing: false,

      init: () => {
        return NetInfo.addEventListener((state) => {
          // isInternetReachable is null until NetInfo has actually probed
          // reachability (not just link state); treating null as "assume
          // reachable" rather than "assume offline" avoids a false pending
          // state on every cold start before that probe resolves.
          const isOnline = Boolean(state.isConnected && state.isInternetReachable !== false);
          set({ isOnline });

          // Always *attempt* a flush when online, not only on a measured
          // offline->online transition. NetInfo fires once immediately on
          // subscribe with whatever the current state already is - on a cold
          // app start with a queue left over from a previous offline
          // session, that first callback is "online" with no transition to
          // key off. flush() is its own re-entrancy guard (isFlushing) and a
          // no-op on an empty queue, so calling it liberally here is safe.
          if (isOnline) get().flush();
        });
      },

      enqueue: (message) => {
        set((state) => ({ queue: [...state.queue, { ...message, status: "pending" }] }));
      },

      // Strictly FIFO and sequential: each send is awaited before the next
      // one starts (CLAUDE.md's "queue in order, flush in order" rule).
      // queue[0] is always "the oldest message not yet confirmed sent",
      // because a successful send removes it immediately and a failed one
      // stops the loop right there - so a second flush() call (the next
      // reconnect, or another NetInfo event firing while this one's already
      // mid-run) naturally resumes at the same spot with no separate cursor
      // to track, and never re-attempts a message that already succeeded.
      flush: async () => {
        if (get().isFlushing) return;
        set({ isFlushing: true });

        while (get().queue.length > 0 && get().isOnline) {
          const next = get().queue[0];
          try {
            // Same send path as an online send (chatStore.sendMessage's
            // direct upsertMessage call) - queuing only changes *when* this
            // runs, never *how*. See the QueuedMessage.id comment above for
            // why replaying this call is safe if flush() gets interrupted
            // and retried.
            await upsertMessage({
              id: next.id,
              conversation_id: next.conversationId,
              role: "user",
              content: next.content,
            });
            // "sent" is momentary, not a resting state we persist: the
            // message already lives in chatStore.messages (added
            // optimistically at compose time in sendMessage), so once the
            // upsert lands there's nothing left for this queue to track -
            // drop it rather than keep a "sent" row no one reads.
            set((state) => ({ queue: state.queue.filter((m) => m.id !== next.id) }));
          } catch {
            // Stop, don't skip: leave this message (and everything behind
            // it) in the queue exactly as-is, marked failed. The next
            // flush() - triggered by the next NetInfo "online" event -
            // starts again from this same message, not from the front of
            // the original queue, so nothing already sent gets resent.
            set((state) => ({
              queue: state.queue.map((m) => (m.id === next.id ? { ...m, status: "failed" } : m)),
            }));
            break;
          }
        }

        set({ isFlushing: false });
      },
    }),
    {
      name: "relay-offline-queue",
      storage: createJSONStorage(() => mmkvStorage),
      // Only the queue itself needs to survive a restart - isOnline and
      // isFlushing are re-derived fresh every session (NetInfo re-fires on
      // init(), and a flush can't legitimately still be "in progress" across
      // a process restart).
      partialize: (state) => ({ queue: state.queue }),
    }
  )
);
