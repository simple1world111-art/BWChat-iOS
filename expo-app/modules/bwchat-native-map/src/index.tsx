import { requireNativeView } from "expo";
import { Platform, type NativeSyntheticEvent, type ViewProps } from "react-native";

export interface BWChatNativeMapRegion {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}

export interface BWChatNativeMapMarker {
  id: string;
  userId?: string | undefined;
  latitude: number;
  longitude: number;
  avatarUrl: string;
  accessibilityLabel: string;
  isCurrentUser: boolean;
  isOnline: boolean;
}

interface NativeMapProps extends ViewProps {
  regionJSON: string;
  markersJSON: string;
  localeIdentifier: string;
  onRegionChange?: (
    event: NativeSyntheticEvent<BWChatNativeMapRegion>,
  ) => void;
  onMarkerPress?: (
    event: NativeSyntheticEvent<{ userId: string }>,
  ) => void;
}

const NativeMapView = Platform.OS === "ios"
  ? requireNativeView<NativeMapProps>("BWChatNativeMap")
  : null;

export function BWChatNativeMap({
  region,
  markers,
  localeIdentifier,
  onRegionChange,
  onMarkerPress,
  ...viewProps
}: ViewProps & {
  region: BWChatNativeMapRegion;
  markers: readonly BWChatNativeMapMarker[];
  localeIdentifier: string;
  onRegionChange?: (region: BWChatNativeMapRegion) => void;
  onMarkerPress?: (userId: string) => void;
}) {
  if (!NativeMapView) return null;
  return (
    <NativeMapView
      {...viewProps}
      localeIdentifier={localeIdentifier}
      markersJSON={JSON.stringify(markers)}
      onMarkerPress={(event: NativeSyntheticEvent<{ userId: string }>) =>
        onMarkerPress?.(event.nativeEvent.userId)
      }
      onRegionChange={(event: NativeSyntheticEvent<BWChatNativeMapRegion>) =>
        onRegionChange?.(event.nativeEvent)
      }
      regionJSON={JSON.stringify(region)}
    />
  );
}
