// Streams a chat completion from OpenRouter (an OpenAI-compatible SSE API).
//
// Why XMLHttpRequest instead of fetch: React Native's fetch polyfill never
// exposes `response.body` as a readable stream, so `for await` over the body
// isn't available. XHR's `onprogress` fires repeatedly while the request is
// in flight and `responseText` grows with each chunk, which is the only
// progressive-read primitive RN's networking layer gives JS. That's enough
// to parse Server-Sent Events by hand.

import { DEFAULT_MODEL, OPENROUTER_URL, SYSTEM_PROMPT } from "@/constants/openrouter";

export type ChatRole = "system" | "user" | "assistant";

export type ChatMessage = {
  role: ChatRole;
  content: string;
};

export type StreamHandle = {
  cancel: () => void;
};

export class OpenRouterError extends Error {
  constructor(
    message: string,
    public readonly code: "E_MISSING_API_KEY" | "E_REQUEST_FAILED" | "E_NETWORK"
  ) {
    super(message);
    this.name = "OpenRouterError";
  }
}

export function streamChatCompletion(
  messages: ChatMessage[],
  callbacks: {
    onToken: (delta: string) => void;
    onComplete: (fullText: string) => void;
    onError: (error: OpenRouterError) => void;
  }
): StreamHandle {
  const apiKey = process.env.EXPO_PUBLIC_OPENROUTER_API_KEY;
  const model = process.env.EXPO_PUBLIC_OPENROUTER_MODEL ?? DEFAULT_MODEL;

  if (!apiKey) {
    callbacks.onError(
      new OpenRouterError(
        "Missing EXPO_PUBLIC_OPENROUTER_API_KEY. Add it to your .env file (get a free key at https://openrouter.ai/keys) and restart the dev server.",
        "E_MISSING_API_KEY"
      )
    );
    return { cancel: () => {} };
  }

  const xhr = new XMLHttpRequest();
  let readOffset = 0;
  let eventBuffer = "";
  let fullText = "";

  xhr.open("POST", OPENROUTER_URL);
  xhr.setRequestHeader("Content-Type", "application/json");
  xhr.setRequestHeader("Authorization", `Bearer ${apiKey}`);
  xhr.setRequestHeader("HTTP-Referer", "https://relay.chat");
  xhr.setRequestHeader("X-Title", "Relay");

  xhr.onprogress = () => {
    // responseText only ever grows while the request is open, so we only
    // need to look at the slice we haven't parsed yet.
    const newText = xhr.responseText.slice(readOffset);
    readOffset = xhr.responseText.length;
    eventBuffer += newText;

    const events = eventBuffer.split("\n\n");
    eventBuffer = events.pop() ?? ""; // last chunk may be a partial event, keep it

    for (const event of events) {
      const dataLine = event.split("\n").find((line) => line.startsWith("data:"));
      if (!dataLine) continue; // e.g. OpenRouter's ": keep-alive" comment lines

      const data = dataLine.slice("data:".length).trim();
      if (data === "[DONE]") continue;

      try {
        const parsed = JSON.parse(data);
        const delta: string | undefined = parsed.choices?.[0]?.delta?.content;
        if (delta) {
          fullText += delta;
          callbacks.onToken(delta);
        }
      } catch {
        // Malformed/partial JSON on this line — skip it, next chunk carries on.
      }
    }
  };

  xhr.onload = () => {
    if (xhr.status >= 200 && xhr.status < 300) {
      callbacks.onComplete(fullText);
    } else {
      callbacks.onError(
        new OpenRouterError(
          `OpenRouter request failed (${xhr.status}): ${xhr.responseText.slice(0, 300)}`,
          "E_REQUEST_FAILED"
        )
      );
    }
  };

  xhr.onerror = () => {
    callbacks.onError(new OpenRouterError("Network error while streaming from OpenRouter.", "E_NETWORK"));
  };

  xhr.send(
    JSON.stringify({
      model,
      stream: true,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
    })
  );

  return { cancel: () => xhr.abort() };
}
