// Two different cadences, on purpose:
// - UI_FLUSH_MS batches streamed tokens into one state update every 50ms so
//   FlashList re-renders ~20x/sec instead of once per token (CLAUDE.md's
//   streaming rule) — smooth, but too chatty to also use for network writes.
// - We only push the growing assistant message to Supabase every
//   SYNC_EVERY_N_TICKS ticks (~300ms), plus always on completion/error. That
//   keeps the web dashboard within the ~1s sync target without firing 20
//   writes/sec at the DB for a single response.
export const UI_FLUSH_MS = 50;
export const SYNC_EVERY_N_TICKS = 6;

// How many messages to fetch per page: the initial load (most recent) and
// each "load older" batch triggered by scrolling to the top. Keeps the
// initial fetch cheap regardless of how long the conversation has grown.
export const MESSAGES_PAGE_SIZE = 50;

// Floor on how long the "loading older messages" spinner stays up. A fast
// network can resolve the fetch in well under this, but flashing the loader
// for a few ms reads as a glitch rather than a load — this makes it a
// perceptible, consistent loading state instead.
export const MIN_HISTORY_LOADER_MS = 2000;
