#!/usr/bin/env node

/**
 * Seeds a conversation with a large number of messages directly in Supabase,
 * for exercising FlashList (item recycling, mixed row heights, scroll
 * performance) at the 1,000+ message scale the assignment asks for.
 *
 * Usage:
 *   node --env-file=.env scripts/seed-messages.js [count]
 *
 * Reuses the same conversation the app itself would load (the most recently
 * created one), so `npx expo start` immediately shows the seeded data.
 */

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.error(
    "Missing EXPO_PUBLIC_SUPABASE_URL or EXPO_PUBLIC_SUPABASE_ANON_KEY.\n" +
      "Run with: node --env-file=.env scripts/seed-messages.js"
  );
  process.exit(1);
}

const MESSAGE_COUNT = Number(process.argv[2]) || 1200;
const BATCH_SIZE = 500;
// Spread messages 20s apart going backwards from now, so created_at order
// (what the app sorts by) matches insertion order.
const SECONDS_BETWEEN_MESSAGES = 20;

const SHORT_LINES = [
  "Got it, thanks.",
  "Can you say more about that?",
  "That makes sense.",
  "What about edge cases?",
  "Let's go with that approach.",
  "Why does that happen?",
  "Can you show an example?",
  "That fixed it.",
  "One more question on this.",
  "Makes sense, moving on.",
];

const LONG_PARAGRAPHS = [
  "Here's a longer explanation. When the list holds a lot of rows, the renderer only keeps the visible window mounted and recycles the rest, which is why item height matters for how smoothly it scrolls.",
  "Breaking this into steps: first the request goes out, then the response streams back a chunk at a time, and finally the UI settles once the stream closes. Each stage can fail independently, so they're handled separately.",
  "A few tradeoffs worth calling out here. Batching updates reduces render count but adds latency before the UI reflects the latest state; the right interval depends on how sensitive the UI is to that delay.",
  "To reproduce: seed a large number of rows, scroll to the middle of the list, then scroll back up quickly. Watch for any stutter or blank frames while cells recycle in and out of the visible window.",
  "The short version: this works because the underlying store only notifies subscribers whose selected slice actually changed, so components that don't depend on that slice skip re-rendering entirely.",
];

function randomFrom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function generateContent(role, index) {
  if (index % 7 === 0) {
    // Occasional multi-paragraph reply to stress mixed row heights.
    const paragraphs = 2 + Math.floor(Math.random() * 3);
    return Array.from({ length: paragraphs }, () => randomFrom(LONG_PARAGRAPHS)).join("\n\n");
  }
  if (role === "user") {
    return randomFrom(SHORT_LINES);
  }
  return randomFrom(LONG_PARAGRAPHS.concat(SHORT_LINES));
}

async function main() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  let { data: conversations, error: fetchError } = await supabase
    .from("conversations")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1);
  if (fetchError) throw fetchError;

  let conversation = conversations[0];
  if (!conversation) {
    const { data, error } = await supabase
      .from("conversations")
      .insert({ title: "Seeded conversation" })
      .select()
      .single();
    if (error) throw error;
    conversation = data;
    console.log(`Created conversation ${conversation.id}`);
  } else {
    console.log(`Reusing conversation ${conversation.id}`);
  }

  const now = Date.now();
  const rows = Array.from({ length: MESSAGE_COUNT }, (_, i) => {
    const role = i % 2 === 0 ? "user" : "assistant";
    // Oldest first: index 0 is furthest in the past.
    const createdAt = new Date(now - (MESSAGE_COUNT - i) * SECONDS_BETWEEN_MESSAGES * 1000).toISOString();
    return {
      id: crypto.randomUUID(),
      conversation_id: conversation.id,
      role,
      content: generateContent(role, i),
      status: "complete",
      created_at: createdAt,
      updated_at: createdAt,
    };
  });

  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    const batch = rows.slice(start, start + BATCH_SIZE);
    const { error } = await supabase.from("messages").insert(batch);
    if (error) throw error;
    console.log(`Inserted ${Math.min(start + BATCH_SIZE, rows.length)}/${rows.length}`);
  }

  console.log(`Done. Conversation ${conversation.id} now has ${MESSAGE_COUNT} new messages.`);
}

main().catch((err) => {
  console.error("Seed failed:", err.message ?? err);
  process.exit(1);
});
