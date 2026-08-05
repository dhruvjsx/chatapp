import type { TurboModule } from "react-native";
import { TurboModuleRegistry } from "react-native";
import type { Double } from "react-native/Libraries/Types/CodegenTypes";

// Codegen turns this literal union into a native string enum check — the
// Kotlin side gets an `ExportFormat` it can `when`-branch on exhaustively
// instead of comparing against magic strings.
export type ExportFormat = "markdown" | "json";

// sizeBytes/durationMs use Double, not plain `number`: Codegen has no
// generic "number" type for TurboModule methods (only Int32/Double/Float,
// see react-native/Libraries/Types/CodegenTypes), and Double avoids an
// Int32 overflow on a very large export or a very slow write.
export type ExportResult = {
  uri: string;
  sizeBytes: Double;
  durationMs: Double;
};

export interface Spec extends TurboModule {
  exportConversation(conversationId: string, format: ExportFormat): Promise<ExportResult>;
}

export default TurboModuleRegistry.getEnforcing<Spec>("ConversationExporter");
