import AudioToolbox
import ExpoModulesCore

public final class BWChatCallSoundsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BWChatCallSounds")

    AsyncFunction("playRingPulseAsync") { (outgoing: Bool) in
      if outgoing {
        // Keep the original CallManager.swift outgoing tone exactly.
        AudioServicesPlaySystemSound(1151)
      } else {
        // Keep the original incoming tone and vibration exactly.
        AudioServicesPlaySystemSound(1005)
        AudioServicesPlaySystemSound(kSystemSoundID_Vibrate)
      }
    }
    .runOnQueue(.main)
  }
}
