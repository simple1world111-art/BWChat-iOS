import { SymbolView } from "expo-symbols";
import { StyleSheet, View } from "react-native";

export function GroupAvatarIcon({ size = 40 }: { size?: number | undefined }) {
  return (
    <View
      style={[
        styles.outer,
        { width: size, height: size, borderRadius: size * 0.22 },
      ]}
    >
      <View
        style={[
          styles.inner,
          {
            borderRadius: size * 0.18,
            inset: Math.max(1.5, size * 0.045),
          },
        ]}
      />
      <SymbolView
        name="bubble.left.fill"
        size={size * 0.65}
        tintColor="#171717"
        style={{ transform: [{ translateY: size * 0.035 }] }}
      />
      <SymbolView
        name="person.3.fill"
        size={size * 0.29}
        weight="bold"
        tintColor="#FFFFFF"
        style={[styles.people, { transform: [{ translateY: -size * 0.015 }] }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  outer: {
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#171717",
  },
  inner: { position: "absolute", backgroundColor: "#FFD43B" },
  people: { position: "absolute" },
});
