import { Host, Picker, Text as SwiftUIText } from "@expo/ui/swift-ui";
import { font, pickerStyle, tag } from "@expo/ui/swift-ui/modifiers";
import { StyleSheet, useColorScheme, View } from "react-native";

import { palette } from "@/theme";

export type SystemSegmentedTabItem<Value extends string> = {
  value: Value;
  title: string;
};

type SystemSegmentedFontWeight = "regular" | "medium" | "semibold" | "bold";

export function SystemSegmentedTabs<Value extends string>({
  items,
  selection,
  onSelectionChange,
  accessibilityIdentifier = "top.segmented.tabs",
  fontWeight = "regular",
  width = 196,
  backgroundColor,
  colorScheme,
}: {
  items: readonly SystemSegmentedTabItem<Value>[];
  selection: Value;
  onSelectionChange(value: Value): void;
  accessibilityIdentifier?: string;
  fontWeight?: SystemSegmentedFontWeight;
  width?: number;
  backgroundColor?: string | undefined;
  colorScheme?: "light" | "dark" | undefined;
}) {
  const scheme = useColorScheme();
  const resolvedColorScheme = colorScheme ?? (scheme === "dark" ? "dark" : "light");
  const theme = palette(resolvedColorScheme);
  const values = new Set(items.map((item) => item.value));

  return (
    <View
      accessibilityLabel={accessibilityIdentifier}
      accessibilityRole="tablist"
      style={[styles.frame, { width }, backgroundColor ? { backgroundColor } : undefined]}
      testID={accessibilityIdentifier}
    >
      <Host
        colorScheme={resolvedColorScheme}
        ignoreSafeArea="all"
        seedColor={theme.accent}
        style={styles.host}
      >
        <Picker
          label={accessibilityIdentifier}
          modifiers={[pickerStyle("segmented")]}
          onSelectionChange={(value) => {
            if (typeof value === "string" && values.has(value as Value)) {
              onSelectionChange(value as Value);
            }
          }}
          selection={selection}
        >
          {items.map((item) => (
            <SwiftUIText
              key={item.value}
              modifiers={[tag(item.value), font({ size: 17, weight: fontWeight })]}
            >
              {item.title}
            </SwiftUIText>
          ))}
        </Picker>
      </Host>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { height: 32, borderRadius: 16 },
  host: { width: "100%", height: "100%" },
});
