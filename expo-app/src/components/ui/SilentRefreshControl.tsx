import { RefreshControl as NativeRefreshControl, type RefreshControlProps } from "react-native";

/**
 * Keeps pull-to-refresh available without exposing network revalidation in the UI.
 *
 * `refreshing` is deliberately forwarded so the native control still owns the
 * gesture lifecycle. Only its visual chrome is suppressed on both platforms.
 */
export function SilentRefreshControl(props: RefreshControlProps) {
  return (
    <NativeRefreshControl
      {...props}
      colors={["transparent"]}
      progressBackgroundColor="transparent"
      tintColor="transparent"
      title=""
      titleColor="transparent"
    />
  );
}
