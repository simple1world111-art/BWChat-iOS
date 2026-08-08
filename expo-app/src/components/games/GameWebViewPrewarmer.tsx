import { StyleSheet } from "react-native";
import WebView from "react-native-webview";

const blankDocument =
  '<!doctype html><html><head><meta name="viewport" content="width=device-width"></head><body></body></html>';

/**
 * react-native-webview already uses one process-wide RNCWKProcessPoolManager
 * and WKWebsiteDataStore.default(). Keeping this blank instance mounted warms
 * that shared WebContent process before the first hosted game is opened.
 */
export function GameWebViewPrewarmer() {
  return (
    <WebView
      accessibilityElementsHidden
      accessible={false}
      allowsInlineMediaPlayback
      cacheEnabled
      domStorageEnabled
      incognito={false}
      importantForAccessibility="no-hide-descendants"
      javaScriptCanOpenWindowsAutomatically={false}
      mediaCapturePermissionGrantType="deny"
      pointerEvents="none"
      scrollEnabled={false}
      setSupportMultipleWindows={false}
      sharedCookiesEnabled
      source={{ html: blankDocument }}
      style={styles.prewarmer}
    />
  );
}

const styles = StyleSheet.create({
  prewarmer: {
    position: "absolute",
    top: -2,
    left: -2,
    width: 1,
    height: 1,
    opacity: 0,
  },
});
