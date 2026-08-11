import type { TurboModule } from "react-native";
import { TurboModuleRegistry } from "react-native";
import type { Double } from "react-native/Libraries/Types/CodegenTypes";

// sizeBytes/durationMs use Double, not plain `number`: Codegen has no
// generic "number" type for TurboModule methods (only Int32/Double/Float,
// see react-native/Libraries/Types/CodegenTypes), and Double avoids an
// Int32 overflow on a very large export or a very slow write.
export type ExportResult = {
  uri: string;
  sizeBytes: Double;
  durationMs: Double;
};

// JSON export was cut (see ARCHITECTURE.md) — markdown is the only format,
// so there's no `format` argument left to pass. A parameter that could only
// ever hold one value would just be dead weight on this contract.
export interface Spec extends TurboModule {
  exportConversation(conversationId: string): Promise<ExportResult>;
}

export default TurboModuleRegistry.getEnforcing<Spec>("ConversationExporter");
