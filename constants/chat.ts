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
