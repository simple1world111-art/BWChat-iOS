const fs = require("node:fs/promises");
const path = require("node:path");

const { withDangerousMod } = require("expo/config-plugins");

// The original Swift app uses an empty UILaunchScreen and renders its branded
// splash from application code. Expo SDK 57 still points Android's generated
// splash theme at @drawable/splashscreen_logo when the splash image is omitted,
// but does not generate that resource. Keep the same plain-white native launch
// surface by supplying an invisible drawable instead of introducing a logo.
const transparentSplashDrawableXml = `<?xml version="1.0" encoding="utf-8"?>
<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle">
  <solid android:color="@android:color/transparent" />
</shape>
`;

async function writeTransparentSplashDrawable(projectRoot) {
  const drawableDirectory = path.join(
    projectRoot,
    "android",
    "app",
    "src",
    "main",
    "res",
    "drawable",
  );
  await fs.mkdir(drawableDirectory, { recursive: true });
  await fs.writeFile(
    path.join(drawableDirectory, "splashscreen_logo.xml"),
    transparentSplashDrawableXml,
    "utf8",
  );
}

module.exports = function withTransparentAndroidSplashDrawable(config) {
  return withDangerousMod(config, [
    "android",
    async (mod) => {
      await writeTransparentSplashDrawable(mod.modRequest.projectRoot);
      return mod;
    },
  ]);
};

module.exports.transparentSplashDrawableXml = transparentSplashDrawableXml;
module.exports.writeTransparentSplashDrawable = writeTransparentSplashDrawable;
