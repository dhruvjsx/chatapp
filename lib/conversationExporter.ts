import { TurboModuleRegistry } from "react-native";
import type { ExportFormat, ExportResult, Spec } from "@/specs/NativeConversationExporter";

export type { ExportFormat, ExportResult };

/**
 * Thin wrapper around the Kotlin ConversationExporter TurboModule (spec:
 * specs/NativeConversationExporter.ts; see CLAUDE.md's native module section
 * and ARCHITECTURE.md). Deliberately uses TurboModuleRegistry.get (nullable)
 * rather than importing the spec's default export, which calls getEnforcing
 * and throws at import time — that would crash app startup right now, since
 * the Kotlin side isn't built yet (see README "What's skipped"). Once it is,
 * this starts resolving the module with no changes needed here.
 */
export async function exportConversation(
  conversationId: string,
  format: ExportFormat
): Promise<ExportResult> {
  const nativeModule = TurboModuleRegistry.get<Spec>("ConversationExporter");
  if (!nativeModule) {
    throw new Error("Export isn't available yet — the native export module hasn't been built.");
  }
  return nativeModule.exportConversation(conversationId, format);
}
