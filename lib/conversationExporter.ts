import { TurboModuleRegistry } from "react-native";
import type { ExportResult, Spec } from "@/specs/NativeConversationExporter";

export type { ExportResult };

/**
 * Thin wrapper around the Kotlin ConversationExporter TurboModule (spec:
 * specs/NativeConversationExporter.ts; see CLAUDE.md's native module section
 * and ARCHITECTURE.md). Deliberately uses TurboModuleRegistry.get (nullable)
 * rather than importing the spec's default export, which calls
 * getEnforcing and throws at import time — that would crash app startup on
 * any environment where the native module hasn't been built (e.g. a JS-only
 * checkout before the first `expo prebuild`), instead of surfacing a normal
 * rejection from the one place that calls this.
 */
export async function exportConversation(conversationId: string): Promise<ExportResult> {
  const nativeModule = TurboModuleRegistry.get<Spec>("ConversationExporter");
  if (!nativeModule) {
    throw new Error("Export isn't available yet — the native export module hasn't been built.");
  }
  return nativeModule.exportConversation(conversationId);
}
