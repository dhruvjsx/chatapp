# Architecture

This is a living document, updated as each priority tier lands (see
[CLAUDE.md](./CLAUDE.md)'s P0/P1/P2 order). It covers the streaming chat +
sync layer, and the `ConversationExporter` native module.

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

## Offline queue

`store/offlineQueueStore.ts` is a separate Zustand store, not part of
`chatStore`, so the connectivity/flush logic is self-contained and readable
on its own. It holds an `isOnline` flag from `@react-native-community/netinfo`
and a `queue: QueuedMessage[]` persisted via `react-native-mmkv`, wired
through zustand's `persist` middleware (a thin adapter maps MMKV's
synchronous `getString`/`set`/`delete` onto the `Storage` interface `persist`
expects — no async round trip, so the queue is hydrated before first render).
The dependency runs one way: `chatStore` reaches into `offlineQueueStore`
(checks `isOnline`, calls `enqueue`); `offlineQueueStore` never imports
`chatStore` back.

`sendMessage` always does the same optimistic append to `chatStore.messages`
first, online or offline — that part never forks. What forks is only the
network step right after: online keeps the existing path (`upsertMessage`,
then start the OpenRouter stream); offline calls `enqueue` and returns before
touching the network — no assistant reply is requested at compose time, since
the LLM call needs network too. It isn't dropped, though: `chatStore`
subscribes to `offlineQueueStore` (one direction only — the queue store never
imports `chatStore`) and calls `requestReplyForLatestTurn()` the moment the
queue transitions from having items to being empty, i.e. every message from
that offline burst has actually landed in Supabase. That requests exactly
one reply for the conversation's current tail, not one per queued message —
three messages sent offline read as one turn, the same way three lines typed
back-to-back before hitting send would. The actual token streaming is a
`streamAssistantReply()` helper closed over inside the store, called by both
this path and `sendMessage`'s online branch — one implementation, two
triggers, so there's still only one way a reply ever gets generated.

**Dedupe**, the part most worth defending live: every message `id` is a
client-generated UUID assigned before any send is attempted, whether it goes
out immediately or sits in the queue first. `upsertMessage` writes with
`onConflict: "id"` against a `uuid primary key` column with no server
default, so replaying a send with the same id is always an `UPDATE`, never a
second `INSERT`. `flush()` leans on exactly this: strictly FIFO, `await`s
each `upsertMessage` before starting the next, removes an item only after
its upsert resolves, and on failure marks it `'failed'` and `break`s instead
of skipping ahead. Removal-only-on-success means `queue[0]` is always "the
oldest not-yet-confirmed message," so a second `flush()` (next reconnect, or
a redundant NetInfo event while one's already running — guarded by
`isFlushing`) resumes at exactly the right spot with no separate cursor.

**Rendering pending state** adds no status field to `Message`.
`MessageBubble` derives "pending" purely from whether the message's id is
still in `offlineQueueStore`'s `queue` — once `flush()` removes it, the icon
disappears on the next render with no explicit "mark as sent" call anywhere.
`chatStore.init()` folds any still-queued messages into fetched history on
load (same `mergeMessage` Realtime rows use), so a message queued in an
earlier session still renders pending after a restart, once `init()` itself
can reach Supabase.

Pinned to `react-native-mmkv` **3.x** over the newer 4.x, which adds a
`react-native-nitro-modules` peer dependency this project has no other use
for; 3.x is a plain TurboModule and needs nothing beyond `newArchEnabled:
true` (already set). Either version needs a real native rebuild
(`prebuild --clean` + `run:android`) after being added.

## Native module: ConversationExporter

`exportConversation(conversationId)` takes no message array — on purpose.
Passing 1,000 messages across the bridge would mean JS first holds
the whole conversation in memory, then serializes it into one giant string
to cross the bridge anyway, relocating the exact problem this module exists
to avoid rather than solving it. So `native/conversation-exporter/` resolves
`conversationId` itself: it pages Supabase's REST API directly (200 rows/page,
same anon key + RLS trust model already in the JS bundle via
`lib/supabase.ts`), writing each page to a buffered `OutputStreamWriter` and
discarding it before fetching the next. Memory use is `O(page size)`, not
`O(conversation length)` — the same "streaming, not one big string" principle
CLAUDE.md calls out for the write side, applied one layer earlier so the
fetch can't undo it.

The fetch, formatting, and write all run on one dedicated background
`Executor` (a plain `Executors.newSingleThreadExecutor()` — CLAUDE.md
explicitly allows this as "an equivalent" to a coroutine, and it needs no
extra Gradle dependency), so the JS/UI thread is never blocked; `invalidate()`
shuts it down so a dev-client reload can't leak the thread. The file is
created via `MediaStore.Downloads` with `IS_PENDING` set until the write
finishes — standard scoped-storage practice for "not ready yet." A failure
mid-write deletes the partial `MediaStore` row before rejecting, so a broken
export never lingers in Downloads looking legitimate. Failures reject with
one of three typed codes (`E_FETCH_FAILED`, `E_CONVERSATION_NOT_FOUND`,
`E_WRITE_FAILED`) rather than a generic error, since each implies a
different fix.

Markdown-only: a `format: 'markdown' | 'json'` parameter existed here too,
matching the assignment brief's literal signature, but the JSON path had a
bug not worth chasing under this take-home's time budget — cut entirely
(the parameter is gone from the TS spec, not just unused in Kotlin) rather
than shipped as a second, broken format alongside a working one. The
codegen'd Java spec (`NativeConversationExporterSpec`) regenerates itself
from `specs/NativeConversationExporter.ts` on the next prebuild, so removing
the parameter there was the only change needed to drop it from the native
method signature too — nothing to keep in sync by hand.

**Surviving `prebuild --clean`.** `/android` is gitignored and fully
regenerated by prebuild, so a native module can't live inside it directly.
The real source lives at `native/conversation-exporter/*.kt`;
`plugins/withConversationExporter.js` (an Expo config plugin) copies it into
the generated project on every prebuild, templating in `android.package` and
the same `EXPO_PUBLIC_SUPABASE_*` env vars `lib/supabase.ts` uses, and adds
`add(ConversationExporterPackage())` to `MainApplication.kt`'s
`getPackages()` via `mergeContents` (idempotent — verified by running
prebuild twice and diffing). Verified with a real
`./gradlew :app:compileDebugKotlin` against react-native-codegen's actual
generated `NativeConversationExporterSpec.java`, and `:app:assembleDebug`,
not just read through.

**Doesn't cover:** no offline fallback — the fetch needs a live Supabase
connection and fails `E_FETCH_FAILED` otherwise. `MediaStore.Downloads`
needs API 29+; older devices reject `E_WRITE_FAILED` rather than falling
back to a legacy storage-permission path.

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
- **Offline queue gaps** (see "Offline queue" above): a `flush()` killed
  mid-send (process death, not just a dropped connection) can leave a
  message whose upsert landed at Supabase but whose queue entry never got
  removed locally — the next flush resends it, safely (same id upserts the
  same row) but redundantly. Two devices flushing the same conversation's
  queue concurrently aren't coordinated beyond that per-row upsert safety
  net. A hung/timing-out send is handled no differently than any other
  failure — marked `'failed'`, flush stops — so "definitely never arrived"
  and "arrived but the response was lost" aren't distinguished, which is
  exactly why retrying via the same id (rather than trying to detect
  duplicates after the fact) is the safer strategy. And `chatStore.init()`
  still needs network to fetch a `conversationId` before anything, queued
  messages included, can render — a cold start while fully offline leaves
  the queue intact in MMKV but invisible until `init()` succeeds, and
  nothing retries it automatically on reconnect today. The reply
  auto-requested once the queue fully drains (see "Offline queue" above)
  only fires on a *complete* drain — a partial flush that hits a failure
  requests no reply until a later reconnect clears the rest, so a batch that
  keeps re-failing on its last message never gets answered until that one
  message finally goes through.
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
2. Wire `chatStore.init()` to retry automatically on the same
   offline-\>online transition that already triggers `offlineQueueStore`'s
   flush, so a cold start while offline recovers on its own instead of
   needing a manual relaunch.
3. Move Realtime fan-out off "every client holds a direct Postgres
   subscription" before it's tested past a handful of concurrent users.
