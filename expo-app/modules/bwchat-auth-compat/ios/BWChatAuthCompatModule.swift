import ExpoModulesCore
import Foundation

public final class BWChatAuthCompatModule: Module {
  private let cachedUserKey = "cached_current_user"
  private let lastActiveAccountKey = "bbchat.last_active_account_id"
  private let selectedLanguageKey = "app.language.selection"

  public func definition() -> ModuleDefinition {
    Name("BWChatAuthCompat")

    AsyncFunction("readCachedUserJSONAsync") { () -> String? in
      guard let data = UserDefaults.standard.data(forKey: self.cachedUserKey) else { return nil }
      return String(data: data, encoding: .utf8)
    }

    AsyncFunction("readLastActiveAccountIdAsync") { () -> String? in
      let value = UserDefaults.standard.string(forKey: self.lastActiveAccountKey)?
        .trimmingCharacters(in: .whitespacesAndNewlines)
      return value?.isEmpty == false ? value : nil
    }

    AsyncFunction("clearCachedUserAsync") {
      UserDefaults.standard.removeObject(forKey: self.cachedUserKey)
    }

    Function("readLanguageSelection") { () -> String? in
      UserDefaults.standard.string(forKey: self.selectedLanguageKey)
    }

    Function("writeLanguageSelection") { (language: String) in
      UserDefaults.standard.set(language, forKey: self.selectedLanguageKey)
    }

    Function("formatFileByteCount") { (byteCount: Int64) -> String in
      ByteCountFormatter.string(fromByteCount: max(byteCount, 0), countStyle: .file)
    }
  }
}
