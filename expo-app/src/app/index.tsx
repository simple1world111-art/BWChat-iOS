import { Redirect } from "expo-router";

import { SplashView } from "@/components/auth/SplashView";
import { useAuth } from "@/providers/AuthProvider";
import {
  authVisualAcceptanceVariant,
  mapVisualAcceptanceEnabled,
  walletVisualAcceptanceVariant,
} from "@/services/visualAcceptance";

export default function IndexScreen() {
  const { user, isBootstrapping } = useAuth();
  if (isBootstrapping) return <SplashView />;
  if (authVisualAcceptanceVariant === "auth-login") return <Redirect href="/(auth)/login" />;
  if (authVisualAcceptanceVariant === "auth-register") return <Redirect href="/(auth)/register" />;
  if (mapVisualAcceptanceEnabled) return <Redirect href="/(tabs)/map" />;
  if (
    walletVisualAcceptanceVariant === "wallet-coins" ||
    walletVisualAcceptanceVariant === "wallet-coins-compact" ||
    walletVisualAcceptanceVariant === "wallet-earnings" ||
    walletVisualAcceptanceVariant === "wallet-earnings-compact"
  )
    return <Redirect href="/wallet" />;
  if (
    walletVisualAcceptanceVariant === "wallet-transactions" ||
    walletVisualAcceptanceVariant === "wallet-transactions-rows" ||
    walletVisualAcceptanceVariant === "wallet-transactions-expense-rows" ||
    walletVisualAcceptanceVariant === "wallet-transactions-error" ||
    walletVisualAcceptanceVariant === "wallet-transactions-loading"
  )
    return <Redirect href="/wallet-transactions" />;
  if (
    walletVisualAcceptanceVariant === "wallet-withdrawals" ||
    walletVisualAcceptanceVariant === "wallet-withdrawals-rows" ||
    walletVisualAcceptanceVariant === "wallet-withdrawals-error" ||
    walletVisualAcceptanceVariant === "wallet-withdrawals-loading"
  )
    return <Redirect href="/wallet-withdrawals" />;
  return <Redirect href={user ? "/(tabs)/conversations" : "/(auth)/login"} />;
}
