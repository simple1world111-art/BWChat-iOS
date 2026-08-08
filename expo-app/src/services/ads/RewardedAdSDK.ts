import mobileAds, { AdsConsent } from "react-native-google-mobile-ads";

let initialized = false;
let preparation: Promise<boolean> | undefined;

export async function prepareRewardedAdSDK(): Promise<boolean> {
  if (initialized) return true;
  if (preparation) return preparation;
  preparation = (async () => {
    try {
      const consent = await AdsConsent.gatherConsent();
      if (!consent.canRequestAds) return false;
      await mobileAds().initialize();
      return true;
    } catch {
      return false;
    }
  })();
  const result = await preparation;
  preparation = undefined;
  if (result) initialized = true;
  return result;
}

export function resetRewardedAdSDKForTests(): void {
  initialized = false;
  preparation = undefined;
}
