package __PACKAGE_NAME__

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/**
 * Registers ConversationExporterModule as a TurboModule. Not autolinked
 * (there's no separate npm package here — this is app-scoped native code),
 * so plugins/withConversationExporter.js adds this package to
 * MainApplication.kt's getPackages() list at prebuild time instead.
 *
 * Extends BaseReactPackage, not the older TurboReactPackage — the latter is
 * a deprecated no-op subclass of the former as of this React Native version.
 */
class ConversationExporterPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
    if (name == ConversationExporterModule.NAME) ConversationExporterModule(reactContext) else null

  override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
    mapOf(
      ConversationExporterModule.NAME to ReactModuleInfo(
        ConversationExporterModule.NAME,
        ConversationExporterModule.NAME,
        false, // canOverrideExistingModule
        false, // needsEagerInit
        false, // isCxxModule
        true, // isTurboModule
      )
    )
  }
}
