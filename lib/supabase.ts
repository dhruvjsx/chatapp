import "react-native-url-polyfill/auto";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY. Add them to your .env file and restart the dev server."
  );
}

const REQUEST_TIMEOUT_MS = 15000;

// Plain fetch has no default timeout, so a dropped/black-holed connection
// (weak signal, a network silently discarding packets instead of rejecting
// the connection) hangs forever instead of erroring — conversationId never
// gets set and nothing ever tells the user why. This turns that silent hang
// into a visible, specific error after 15s instead.
async function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`Request to Supabase timed out after ${REQUEST_TIMEOUT_MS / 1000}s — check your network connection.`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
  global: {
    fetch: fetchWithTimeout,
  },
});
