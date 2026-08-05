export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// google/gemma-4-26b-a4b-it:free was picked over other free-tier models
// because it streams `delta.content` directly with no reasoning phase.
// Reasoning-tagged free models (e.g. gpt-oss-20b:free) stream `delta.reasoning`
// first and leave `delta.content` empty for several seconds, which the parser
// in lib/openrouter.ts ignores — the reply bubble would sit on the "…"
// placeholder far longer than it should. If this model gets
// deprecated/rate-limited, check openrouter.ai/models?max_price=0 for a
// currently-live, non-reasoning replacement.
export const DEFAULT_MODEL = "google/gemma-4-26b-a4b-it:free";

export const SYSTEM_PROMPT = "You are a helpful, concise assistant.";
