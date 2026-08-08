import { useEffect } from "react";
import { AppState } from "react-native";

import { useAuth } from "@/providers/AuthProvider";
import { chatRealtimeService } from "@/services/realtime/ChatRealtimeService";

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

  useEffect(() => {
    if (user?.user_id) chatRealtimeService.start(user.user_id);
    else chatRealtimeService.stop();
    return () => chatRealtimeService.stop();
  }, [user?.user_id]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && user?.user_id) chatRealtimeService.reconnectNow();
    });
    return () => subscription.remove();
  }, [user?.user_id]);

  return children;
}
