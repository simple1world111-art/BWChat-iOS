import * as Network from "expo-network";
import { useEffect } from "react";
import { AppState } from "react-native";

import { useAuth } from "@/providers/AuthProvider";
import { catchUpConversationState } from "@/services/conversations/ChatSyncCatchUp";
import { conversationSyncCoordinator } from "@/services/conversations/ConversationSyncCoordinator";
import { publishConversationCatalogRefresh } from "@/services/conversations/ConversationRepository";
import { chatRealtimeService } from "@/services/realtime/ChatRealtimeService";

export function RealtimeProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

  useEffect(() => {
    const ownerId = user?.user_id?.trim() ?? "";
    if (ownerId) {
      conversationSyncCoordinator.start(ownerId);
      chatRealtimeService.start(ownerId);
    } else {
      chatRealtimeService.stop();
    }
    return () => {
      if (ownerId) conversationSyncCoordinator.stop(ownerId);
      chatRealtimeService.stop();
    };
  }, [user?.user_id]);

  useEffect(() => {
    const ownerId = user?.user_id?.trim() ?? "";
    const initiallyActive = AppState.currentState === "active";
    let previouslyActive = initiallyActive;
    chatRealtimeService.setApplicationActive(initiallyActive);
    if (ownerId) conversationSyncCoordinator.setApplicationActive(ownerId, initiallyActive);
    const subscription = AppState.addEventListener("change", (state) => {
      const active = state === "active";
      const resumed = active && !previouslyActive;
      previouslyActive = active;
      chatRealtimeService.setApplicationActive(active);
      if (ownerId) conversationSyncCoordinator.setApplicationActive(ownerId, active);
      if (resumed && ownerId) {
        void conversationSyncCoordinator.request(ownerId, "app_foreground");
        chatRealtimeService.reconnectNow();
      }
    });
    return () => subscription.remove();
  }, [user?.user_id]);

  useEffect(() => {
    const ownerId = user?.user_id?.trim() ?? "";
    if (!ownerId) return;
    let active = true;
    let previousNetworkAvailable: boolean | null = null;
    const applyNetworkState = (state: Network.NetworkState) => {
      if (!active) return;
      const available = state.isConnected !== false && state.isInternetReachable !== false;
      const recovered = previousNetworkAvailable === false && available;
      previousNetworkAvailable = available;
      chatRealtimeService.setNetworkAvailable(available);
      conversationSyncCoordinator.setNetworkAvailable(ownerId, available);
      if (recovered) void conversationSyncCoordinator.request(ownerId, "network_available");
    };
    void Network.getNetworkStateAsync()
      .then(applyNetworkState)
      .catch(() => undefined);
    const subscription = Network.addNetworkStateListener(applyNetworkState);
    return () => {
      active = false;
      subscription.remove();
    };
  }, [user?.user_id]);

  useEffect(() => {
    const ownerId = user?.user_id?.trim() ?? "";
    if (!ownerId) return;
    const controller = new AbortController();
    const unsubscribe = conversationSyncCoordinator.subscribe(ownerId, async (request) => {
      const forceAuthoritativeSnapshot = request.reasons.includes("realtime_missing_conversation");
      if (forceAuthoritativeSnapshot) {
        await catchUpConversationState(ownerId, controller.signal, {
          forceAuthoritativeSnapshot: true,
        });
      } else {
        await catchUpConversationState(ownerId, controller.signal);
      }
      if (request.full) publishConversationCatalogRefresh(ownerId);
    });
    return () => {
      controller.abort();
      unsubscribe();
    };
  }, [user?.user_id]);

  useEffect(() => {
    const ownerId = user?.user_id?.trim() ?? "";
    if (!ownerId) return;
    let previousStatus: "disconnected" | "connecting" | "connected" = "disconnected";
    const unsubscribeStatus = chatRealtimeService.subscribeStatus((status) => {
      const connectedNow = status === "connected" && previousStatus !== "connected";
      previousStatus = status;
      if (connectedNow) void conversationSyncCoordinator.request(ownerId, "realtime_connected");
    });
    const unsubscribeEvents = chatRealtimeService.subscribe((event) => {
      if (event.delivery_source === "catch_up") return;
      if (event.type === "refresh_conversations") {
        void conversationSyncCoordinator.request(ownerId, event.reason);
      } else if (event.type === "direct_message_hint") {
        const contactId =
          event.sender_id === ownerId
            ? event.receiver_id
            : event.receiver_id === ownerId
              ? event.sender_id
              : "";
        if (contactId) {
          void conversationSyncCoordinator.request(ownerId, "direct_message_hint", {
            conversation_type: "dm",
            conversation_id: contactId,
            message_id: event.message_id,
            message_version: event.message_version,
          });
        }
      } else if (event.type === "group_message_hint") {
        void conversationSyncCoordinator.request(ownerId, "group_message_hint", {
          conversation_type: "group",
          conversation_id: String(event.group_id),
          message_id: event.message_id,
          message_version: event.message_version,
        });
      }
    });
    return () => {
      unsubscribeStatus();
      unsubscribeEvents();
    };
  }, [user?.user_id]);

  return children;
}
