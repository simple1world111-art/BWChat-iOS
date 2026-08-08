const { withAppDelegate } = require("expo/config-plugins");

const DISABLE_DEV_LOADING_VIEW = `#if DEBUG
    // Acceptance screenshots must never include React Native's blue Reloading/Refreshing banner.
    RCTDevLoadingViewSetEnabled(false)
#endif`;

function injectDisabledDevLoadingView(contents) {
  if (contents.includes("RCTDevLoadingViewSetEnabled(false)")) {
    return contents;
  }

  const anchor = "    let delegate = ReactNativeDelegate()";
  if (!contents.includes(anchor)) {
    throw new Error("Unable to locate the ReactNativeDelegate initialization in AppDelegate.swift");
  }

  return contents.replace(anchor, `${DISABLE_DEV_LOADING_VIEW}\n\n${anchor}`);
}

module.exports = function withDisabledDevLoadingView(config) {
  return withAppDelegate(config, (mod) => {
    if (mod.modResults.language !== "swift") {
      throw new Error("with-disabled-dev-loading-view requires a Swift AppDelegate");
    }

    mod.modResults.contents = injectDisabledDevLoadingView(mod.modResults.contents);
    return mod;
  });
};

module.exports.injectDisabledDevLoadingView = injectDisabledDevLoadingView;
