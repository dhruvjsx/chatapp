const fs = require("fs");
const path = require("path");
const { withDangerousMod, withMainApplication } = require("@expo/config-plugins");
const { mergeContents } = require("@expo/config-plugins/build/utils/generateCode");

// `android/` is gitignored and rebuilt from scratch by `expo prebuild
// --clean` (see CLAUDE.md), so the ConversationExporter Kotlin TurboModule
// can't live inside it directly — anything placed there would be deleted on
// the next clean prebuild. This plugin is what makes it survive that: it
// copies the real source of truth (native/conversation-exporter/*.kt) into
// the generated Android project on every prebuild, and registers the
// resulting package the same way the "Packages that cannot be autolinked
// yet" comment in MainApplication.kt already invites you to.
const NATIVE_SRC_DIR = path.join(__dirname, "..", "native", "conversation-exporter");
const KOTLIN_FILES = ["ConversationExporterModule.kt", "ConversationExporterPackage.kt"];

function withConversationExporterSource(config) {
  return withDangerousMod(config, [
    "android",
    (config) => {
      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
      const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
      if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error(
          "withConversationExporter: missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY.\n" +
            "The export module fetches a conversation's messages straight from Supabase on a background\n" +
            "thread (see native/conversation-exporter/ConversationExporterModule.kt), so it needs these\n" +
            "baked in at prebuild time the same way lib/supabase.ts needs them at JS build time.\n" +
            "Add them to .env (see .env.example) and re-run prebuild."
        );
      }

      const packageName = config.android && config.android.package;
      if (!packageName) {
        throw new Error("withConversationExporter: app.json is missing android.package.");
      }

      const destDir = path.join(
        config.modRequest.platformProjectRoot,
        "app",
        "src",
        "main",
        "java",
        ...packageName.split(".")
      );
      fs.mkdirSync(destDir, { recursive: true });

      for (const fileName of KOTLIN_FILES) {
        const template = fs.readFileSync(path.join(NATIVE_SRC_DIR, fileName), "utf8");
        const contents = template
          .split("__PACKAGE_NAME__").join(packageName)
          .split("__SUPABASE_URL__").join(supabaseUrl)
          .split("__SUPABASE_ANON_KEY__").join(supabaseAnonKey);
        fs.writeFileSync(path.join(destDir, fileName), contents, "utf8");
      }

      return config;
    },
  ]);
}

function withConversationExporterRegistration(config) {
  return withMainApplication(config, (config) => {
    const merged = mergeContents({
      tag: "conversation-exporter-package",
      src: config.modResults.contents,
      newSrc: "      add(ConversationExporterPackage())",
      anchor: /PackageList\(this\)\.packages\.apply\s*\{/,
      offset: 1,
      comment: "//",
    });
    config.modResults.contents = merged.contents;
    return config;
  });
}

module.exports = function withConversationExporter(config) {
  config = withConversationExporterSource(config);
  config = withConversationExporterRegistration(config);
  return config;
};
