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
## What's skipped (so far)

- Offline queue — removed. An earlier pass had a separate Zustand store
  (`store/offlineQueueStore.ts`) that detected connectivity via
  `@react-native-community/netinfo` and persisted a FIFO send queue through
  `react-native-mmkv`, but `react-native-mmkv` 3.x requires a genuinely
  New-Architecture-compiled native binary (TurboModules), and that dependency
  cost more debugging time than the feature was worth for this pass — see
  ARCHITECTURE.md's "Offline / conflict model" for what this means in
  practice (a send attempted while offline just fails like any other network
  error, with no local persistence or replay). Worth reinstating as P1 work
  if time allows.
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
- A message sent while offline currently just fails like any other network
  error — no local queue, no persistence, no replay on reconnect (see "What's
  skipped" above).

## AI tools used

- Claude Code: scaffolded the chat UI, the OpenRouter streaming client, and
  the Zustand store wiring it to Supabase; also built (and later removed) an
  offline queue store, its MMKV/NetInfo wiring, and the related
  `MessageBubble`/offline-banner UI.

## APK size

Not yet built.
