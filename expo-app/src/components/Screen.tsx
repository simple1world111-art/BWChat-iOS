import { SafeAreaView } from "react-native-safe-area-context";
import { StyleSheet, useColorScheme, type ViewStyle } from "react-native";

import { palette } from "@/theme";

export function Screen({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const theme = palette(useColorScheme());
  return <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }, style]}>{children}</SafeAreaView>;
}

const styles = StyleSheet.create({ screen: { flex: 1 } });
