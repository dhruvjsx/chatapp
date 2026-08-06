# Relay

A streaming AI chat client (mobile) plus a minimal web dashboard that stay in
sync in real time. Built with Expo (prebuild / dev client, New Architecture),
TypeScript strict, Zustand, FlashList, Kotlin TurboModules, and Supabase.

See [CLAUDE.md](./CLAUDE.md) for the full assignment brief and constraints.

## Setup (from a clean clone)

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env` and fill in real values:

   ```bash
   cp .env.example .env
   ```

   - `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` — from a free
     [Supabase](https://supabase.com) project. Run the SQL in
     `supabase/migrations/` against that project (SQL editor or the CLI)
     before first run — it creates the `conversations`/`messages` tables,
     RLS policies, and enables Realtime on both.
   - `EXPO_PUBLIC_OPENROUTER_API_KEY` — from [openrouter.ai/keys](https://openrouter.ai/keys)
     (free, no card required for `:free`-suffixed models).
   - `EXPO_PUBLIC_OPENROUTER_MODEL` — defaults to a free Gemma model
     (`google/gemma-4-26b-a4b-it:free`), chosen because it streams
     `delta.content` directly with no reasoning phase — reasoning-tagged free
     models (e.g. `gpt-oss-20b:free`) stream `delta.reasoning` first and leave
     `delta.content` empty for several seconds, which this app's parser
     ignores, so the reply bubble sits on the "…" placeholder far longer than
     it should. Free models also occasionally get deprecated/rate-limited on
     OpenRouter's end; if replies start failing, check
     [openrouter.ai/models?max_price=0](https://openrouter.ai/models?max_price=0)
     for a currently-live, non-reasoning one and swap the env var.

3. Generate native projects and run the dev client (Expo Go is not supported
   here — the app needs custom native code):

   ```bash
   npx expo prebuild --clean
   npx expo run:android
   ```

## What's finished

- Chat screen ([app/(tabs)/index.tsx](./app/(tabs)/index.tsx)): token-by-token
  streaming from OpenRouter, rendered in a `FlashList`, with auto-scroll that
  releases as soon as the user scrolls up.
- OpenRouter streaming client ([lib/openrouter.ts](./lib/openrouter.ts)):
  hand-parsed Server-Sent Events over `XMLHttpRequest` (React Native's `fetch`
  doesn't expose a readable response body — see the comment at the top of
  that file for why).
- Chat state ([store/chatStore.ts](./store/chatStore.ts)): Zustand store that
  batches streamed tokens into one re-render every ~50ms, persists messages to
  Supabase (throttled to ~300ms during streaming, always on completion), and
  merges incoming Supabase Realtime events so a second client (e.g. the future
  web dashboard) editing the same conversation doesn't produce duplicate rows.
- Offline send queue ([store/offlineQueueStore.ts](./store/offlineQueueStore.ts)):
  a separate Zustand store that detects connectivity via
  `@react-native-community/netinfo` and persists a FIFO send queue through
  `react-native-mmkv` (synchronous, so the queue rehydrates before first
  render). `chatStore.sendMessage` checks `isOnline` before deciding whether
  to send live or enqueue; on reconnect the queue flushes strictly in order,
  one `await` at a time, through the *same* `upsertMessage` call an online
  send uses. Dedupe is the client-generated UUID (assigned before any send is
  attempted) plus `upsertMessage`'s `onConflict: "id"` upsert — replaying a
  send after an interrupted flush overwrites the same row instead of
  duplicating it. `MessageBubble` shows a pending message as greyed-out with
  a clock icon purely by checking queue membership, no separate status flag
  to keep in sync. Once the queue fully drains, `chatStore` (subscribed to
  `offlineQueueStore`, one direction only) requests a single assistant reply
  for whatever was just sent — messages queued offline aren't left
  unanswered, but a burst of several queued messages gets one combined
  reply, not one per message. See "Testing the offline queue" below and
  ARCHITECTURE.md's "Offline / conflict model" for what this does and
  doesn't cover.
  - An earlier pass at this was pulled for cost/time reasons under deadline
    pressure (see git history / ARCHITECTURE.md's prior "Offline queue —
    removed" note) rather than any diagnosed incompatibility. Reinstated this
    session, pinned to `react-native-mmkv` **3.x** rather than the newer 4.x
    — 4.x adds a `react-native-nitro-modules` peer dependency (a second
    native module framework) this project has no other use for, so 3.x's
    plain-TurboModule shape is the lower-risk choice given `newArchEnabled`
    is already `true` in both `app.json` and `android/gradle.properties`.
    Requires a fresh native rebuild after this change — see Setup step 3;
    it's not something a JS-only reload can pick up.

## What's skipped (so far)

- Web dashboard — not started.
- `ConversationExporter` Kotlin TurboModule — not started. The chat header
  ([components/chat/chat-header.tsx](./components/chat/chat-header.tsx)) has
  the "Relay AI" top bar and a three-dot menu with "Export as Markdown" /
  "Export as JSON" wired to the exact calling contract
  ([lib/conversationExporter.ts](./lib/conversationExporter.ts)), so tapping
  it surfaces a clear "not available yet" alert instead of a crash — the
  native side is the only piece left to build.
- Multi-conversation UI — the app currently loads/creates a single ongoing
  conversation rather than letting you start new ones from the UI.
- Stop/regenerate button, markdown rendering, dark-mode-specific polish — P2,
  not started.

## Known bugs / gaps

- A message arriving mid-stream (from another client, or another turn)
  interleaves into the timeline immediately rather than blocking or queueing
  — see ARCHITECTURE.md's "Offline / conflict model" section for the
  decision and the gap it doesn't cover (no arbitration for which client
  calls the LLM on a message from another client).
- If the OpenRouter request fails partway through a stream, the partial
  assistant reply is kept and marked `status: "error"` rather than retried
  automatically.
- No seeded 1,000+ message dataset yet, so FlashList's behavior at that scale
  hasn't been exercised.
- `FlashList` v2 (the version this repo installs) dropped `estimatedItemSize`
  in favor of auto-measuring items and added `maintainVisibleContentPosition`
  specifically for chat UIs — used here instead of hand-rolled scroll-offset
  tracking. Worth calling out explicitly since CLAUDE.md's phrasing assumes
  the v1 API.
- Offline queue known gaps (see ARCHITECTURE.md's "Offline / conflict model"
  for the full list): a `flush()` that dies mid-send (app killed, not just a
  dropped connection) can leave a message in an ambiguous state — the upsert
  may have actually landed at Supabase before the crash, but the queue item
  never got removed locally, so the next flush resends it. That resend is
  safe (same UUID upserts over the same row, so no duplicate is created) —
  just a harmless repeat write of identical content. Two devices
  flushing queues for the *same* conversation concurrently aren't
  coordinated in any way beyond that same per-row upsert safety net. A
  reply is auto-requested once the queue fully drains (`chatStore`
  subscribes to `offlineQueueStore` for this), but only on a *complete*
  drain — if a flush partially succeeds and then hits a failure, no reply
  fires until a later reconnect clears the rest, so a batch whose last
  message keeps failing never gets answered until that message finally
  goes through. The initial conversation load (`chatStore.init()`) still
  needs network itself — if the app is
  killed and relaunched while *fully* offline (never contacted Supabase this
  session), it can't fetch a `conversationId` at all, so queued messages
  can't render until that first fetch succeeds; the queue itself is intact
  in MMKV regardless and flushes correctly once it does.

## Testing the offline queue

**Main flow** (queue + FIFO flush + dedupe):

1. Launch the dev client and let the chat screen load normally (so
   `conversationId` is set).
2. Cut connectivity — either toggle Airplane Mode from the emulator's quick
   settings, or from a host shell:
   ```bash
   adb shell svc wifi disable
   adb shell svc data disable
   ```
3. Send 3 messages. Each should appear immediately, greyed out with a small
   clock icon ("Waiting to send…") — confirms they're queued, not silently
   dropped or blocked.
4. Restore connectivity:
   ```bash
   adb shell svc wifi enable
   adb shell svc data enable
   ```
5. Confirm all 3 flip from pending to normal, in the order they were sent,
   with no duplicate bubbles — and check the `messages` table in the
   Supabase dashboard for exactly one row per message id.

**Secondary check** (MMKV persistence across a restart — proves the queue
survives at the storage layer, not that the UI recovers automatically): with
the app still offline after step 3 above, force-kill and relaunch it, still
offline. `chatStore.init()` needs network to fetch `conversationId` at all
(a pre-existing, unrelated gap — see "Known bugs / gaps"), so the pending
bubbles won't reappear until it succeeds; there's no automatic retry today,
so a second relaunch once connectivity is back is what actually triggers it.
What this check is really confirming: inspect the MMKV-backed key
(`relay-offline-queue`) — e.g. via `adb shell run-as <package> ...` on the
app's data dir, or a temporary log line in `offlineQueueStore.ts` — and see
the 3 messages still sitting there after the restart, proving they weren't
silently dropped by the process kill.

## AI tools used

- Claude Code: scaffolded the chat UI, the OpenRouter streaming client, and
  the Zustand store wiring it to Supabase; built the offline queue store
  (`store/offlineQueueStore.ts`), its MMKV/NetInfo wiring, `chatStore`'s
  online/offline branch in `sendMessage`, and the pending/failed styling in
  `MessageBubble`.

## APK size

Not yet built.
