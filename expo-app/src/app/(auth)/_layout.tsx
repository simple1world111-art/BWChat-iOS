import { Stack } from "expo-router";

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="login" options={{ animation: "fade" }} />
      <Stack.Screen name="forgot-password" options={{ animation: "slide_from_right" }} />
      <Stack.Screen
        name="account-deletion-accepted"
        options={{ animation: "fade", gestureEnabled: false }}
      />
      <Stack.Screen
        name="register"
        options={{ presentation: "fullScreenModal", animation: "slide_from_bottom" }}
      />
    </Stack>
  );
}
