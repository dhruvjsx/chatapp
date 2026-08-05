# Architecture

This is a living document, updated as each priority tier lands (see
[CLAUDE.md](./CLAUDE.md)'s P0/P1/P2 order). Right now it covers the streaming
chat + sync layer, since that's what exists. The native module section will
be added once `ConversationExporter` is built; the offline-queue section once
P1 lands.

## State and data flow

The chat screen holds no local component state for messages — it reads from
a single Zustand store (`store/chatStore.ts`) so the same conversation state
could later be shared with other screens (e.g. a conversation list) without
prop drilling. `init()` loads (or creates) one conversation from Supabase,
fetches its message history, and opens a `postgres_changes` Realtime
subscription filtered to that `conversation_id`.

Sending a message does three things in order: (1) optimistically append the
user message and an empty "streaming" assistant placeholder to local state so
the UI reacts instantly, (2) write the user message to Supabase, (3) open a
streamed completion request to OpenRouter. Every message row — user or
assistant — carries a client-generated id (`lib/id.ts`) created before any
network call, which is what makes `upsertMessage`'s `onConflict: "id"` safe to
call repeatedly: patching an assistant reply's content on every flush is the
same write path as the initial insert, not a second code path.

Token deltas from OpenRouter don't hit React state directly. They accumulate
in a plain closure variable and get flushed into the store every 50ms by a
`setInterval`, so FlashList re-renders ~20x/sec regardless of how fast the
model streams — the fix for the "don't re-render per token" rule. Supabase
writes are throttled further still (every 6th flush, ~300ms, plus always on
completion/error), because the web dashboard doesn't need every intermediate
token — it needs to feel live, not identical to what's on-screen on the phone
at every instant.

Realtime events coming back in are merged by id (`mergeMessage`), which
serves double duty: it's what makes the phone pick up a second client's edits
to the same conversation, and it's what makes the phone's own writes echoing
back through Realtime a no-op instead of a duplicate bubble.

## Bottlenecks at 200,000 users

None of this scales past a demo as-is, and the ceiling is Supabase's free
tier, not the app code:

- **Realtime connections**: the free tier caps concurrent Realtime
  connections in the low hundreds. This app opens one Realtime socket per
  open app/tab. 200k concurrent users would need either a paid tier with a
  much higher cap, or an architecture where clients don't hold a direct
  Postgres change-feed subscription each — e.g. a fan-out layer (a small
  server or Supabase Edge Function) that clients long-poll or connect to
  instead.
- **Postgres connections**: direct Postgres connections are capped in the
  double digits on the free tier; Supabase's pooler (pgbouncer) raises the
  practical ceiling but pooled connections still aren't free at 200k
  concurrent writers. Every streamed reply currently issues its own `upsert`
  every ~300ms — fine for one user, a real write-amplification problem at
  scale.
- **Fan-out cost**: a message insert fans out to every subscriber of that
  conversation's channel. For 1:1 chat (this app's shape) that's cheap. It
  stops being cheap the moment a conversation has many simultaneous viewers.
- **Message ordering**: ordering relies on `created_at` plus insertion order;
  two messages created in the same millisecond by different writers have no
  tiebreaker. Not a problem for one user typing, a real one once several
  writers touch a conversation.
- **LLM cost/latency**: free OpenRouter models are rate- and quota-limited
  per key (on the order of tens of requests per minute, low hundreds per day
  without purchased credits). At real usage this needs a paid model tier and
  per-user rate limiting the app doesn't have today.
- **Cold starts**: Supabase's free-tier Postgres pauses after a period of
  inactivity; the first request after a pause eats a multi-second wake-up
  penalty. `init()` has no loading state for that today — the chat screen
  would just look stuck.

## Offline / conflict model — what's not handled

- **Message arriving mid-stream**: decided as interleave, not block or
  queue. `mergeMessage` (`store/chatStore.ts`) merges every Realtime row the
  instant it arrives, regardless of whether this device's `isStreaming` is
  true for some other message — `isStreaming` only gates this device's own
  composer, it never gates rendering. Two streaming assistant bubbles (this
  device's own, updating every 50ms from its in-process token stream; and
  another device's, updating in ~300ms chunks as its upserts echo back
  through Realtime) can be on screen at once, each keyed by its own id. The
  alternative (block new messages from rendering until the local stream
  finishes) was rejected because it makes a slow LLM reply on this device
  delay a message from another client showing up at all — directly
  defeating the ~1s real-time sync goal. New rows are inserted in
  `created_at` order rather than always appended, specifically to keep this
  correct even though the locally-optimistic message this device is
  streaming was timestamped off the client clock before the server had a
  say (see the comment on `mergeMessage`).
- **No arbitration for who replies.** Nothing decides which client calls the
  LLM for a given user message — only the device whose composer sent it
  ever calls OpenRouter for it. A message inserted by another client (e.g.
  the web dashboard, once built) does not get an assistant reply unless
  that client also triggers a completion for it. If two clients are both
  open on the same conversation and both react to the same inbound message,
  both would independently start a completion, producing two assistant
  replies for one user turn. Fixing this needs a single source of truth for
  "who answers" (a Postgres trigger + Edge Function, or a claimed-by lock
  column) — out of scope here since it needs a real backend function, not
  just a client-side change.
- No offline queue yet. If `upsertMessage` fails (device offline, request
  timeout), the error is surfaced but the message is not retried or queued —
  it's silently missing from Supabase even though it stayed visible,
  "sent," in the local UI. This is the biggest gap and the top of the P1
  list for a reason.
- No dedupe-on-reconnect logic exists yet because there's no retry path to
  dedupe against. The client-generated id is already in place specifically so
  that P1 work is a queue + flush loop, not a redesign of the write path.
- Concurrent edits to the same message row are last-write-wins via `upsert`.
  There's no version vector or optimistic-lock check, so two clients patching
  the same assistant message id at once (shouldn't happen in the current
  single-writer-per-message design, but nothing enforces it) would silently
  drop one write.
- No auth: RLS policies allow any anon key holder to read and write any
  conversation. Fine for a single-user take-home, not fine beyond it.

## What I'd fix first before a Monday production launch

1. Auth + per-user conversation ownership — the current open RLS policy is
   the least defensible part of this system as soon as a second real user
   exists.
2. The offline queue (P1) — without it, message loss on flaky connections is
   silent, which is worse than an obvious error.
3. Move Realtime fan-out off "every client holds a direct Postgres
   subscription" before it's tested past a handful of concurrent users.
