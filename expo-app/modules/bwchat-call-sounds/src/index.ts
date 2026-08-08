import { requireOptionalNativeModule } from "expo";

interface BWChatCallSoundsNativeModule {
  playRingPulseAsync(outgoing: boolean): Promise<void>;
}

const nativeModule = requireOptionalNativeModule<BWChatCallSoundsNativeModule>("BWChatCallSounds");

export async function playCallRingPulseAsync(outgoing: boolean): Promise<boolean> {
  if (!nativeModule?.playRingPulseAsync) return false;
  await nativeModule.playRingPulseAsync(outgoing);
  return true;
}
