import { randomUUID } from "expo-crypto";
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { AppState } from "react-native";

import { endCall as endCallRequest } from "@/api/bwchat";
import { useAuth } from "@/providers/AuthProvider";
import { useCall } from "@/providers/CallProvider";
import { useLiveCall } from "@/providers/LiveCallProvider";
import { useWallet } from "@/providers/WalletProvider";
import {
  AgentLiveMatchCoordinator,
  type AgentLiveMatchRuntime,
} from "@/services/live/AgentLiveMatchCoordinator";
import { shouldCancelAgentLiveMatchForAppState } from "@/services/live/AgentLiveMatchLifecycle";
import type { AgentLiveMatchStatus } from "@/services/live/AgentLiveMatchStateMachine";
import { normalizeLiveInvitationPayload } from "@/services/live/LiveInvitationPayload";
import {
  cancelAgentLiveMatch,
  getCurrentLiveSlot,
  joinAcceptedLiveCall,
  startAgentLiveMatch,
} from "@/services/live/LiveLobbyRepository";
import { fallbackLiveBillingPolicy } from "@/services/live/LiveLobbyModels";
import { chatRealtimeService } from "@/services/realtime/ChatRealtimeService";
import { refreshWalletBalance } from "@/services/wallet/WalletRepository";

interface UseAgentLiveVideoMatchInput {
  onConnected(): void;
}

export interface AgentLiveVideoMatchController {
  status: AgentLiveMatchStatus;
  isActive: boolean;
  start(roleSetting: string, sourceAgentId: string): Promise<void>;
  cancel(): void;
  reset(): void;
}

export function useAgentLiveVideoMatch(
  input: UseAgentLiveVideoMatchInput,
): AgentLiveVideoMatchController {
  const { user } = useAuth();
  const { session, connectAcceptedLiveCall, endCall } = useCall();
  const { hasInvitation } = useLiveCall();
  const { applyBalance } = useWallet();
  const [status, setStatus] = useState<AgentLiveMatchStatus>({ kind: "idle" });
  const runtime = useMemo<AgentLiveMatchRuntime>(
    () => ({
      makeOperationId: randomUUID,
      currentUserId: () => user?.user_id ?? "",
      hasCurrentCall: () => session !== null,
      hasLiveInvitation: () => hasInvitation,
      synchronizeCurrentUserLiveStatus: async () => {
        const slot = await getCurrentLiveSlot();
        return slot !== null && slot.status.trim().toLocaleLowerCase() !== "ended";
      },
      refreshBalance: refreshWalletBalance,
      applyBalance,
      startMatch: startAgentLiveMatch,
      cancelMatch: cancelAgentLiveMatch,
      joinAcceptedCall: joinAcceptedLiveCall,
      endAcceptedCall: endCallRequest,
      connectAcceptedCall: (call) =>
        connectAcceptedLiveCall(
          {
            userId: call.peer.userId,
            nickname: call.peer.username,
            avatarUrl: call.peer.avatarUrl,
            roleSetting: call.requestedRoleSetting || call.peer.characterSetting,
            billingPolicy:
              call.credentials.billing_policy ?? fallbackLiveBillingPolicy,
          },
          call.credentials,
          "video",
          true,
        ),
      endLocalCall: endCall,
      onStatus: setStatus,
      onConnected: input.onConnected,
    }),
    [
      applyBalance,
      connectAcceptedLiveCall,
      endCall,
      hasInvitation,
      input.onConnected,
      session,
      user?.user_id,
    ],
  );
  const [coordinator] = useState(() => new AgentLiveMatchCoordinator(runtime));

  useLayoutEffect(() => {
    coordinator.updateRuntime(runtime);
  }, [coordinator, runtime]);

  useEffect(
    () =>
      chatRealtimeService.subscribe((event) => {
        if (event.type !== "live_signal") return;
        const data = normalizeLiveInvitationPayload(event.data);
        if (event.signal_type === "one_to_one_live.call_accepted") {
          coordinator.receiveAccepted(data);
        } else if (event.signal_type === "one_to_one_live.match_exhausted") {
          coordinator.receiveUnavailable("exhausted", data);
        } else if (event.signal_type === "one_to_one_live.match_cancelled") {
          coordinator.receiveUnavailable("cancelled", data);
        }
      }),
    [coordinator],
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => {
      if (shouldCancelAgentLiveMatchForAppState(next)) coordinator.cancel();
    });
    return () => subscription.remove();
  }, [coordinator]);

  useEffect(
    () => () => {
      coordinator.dispose();
    },
    [coordinator],
  );

  const start = useCallback(
    async (roleSetting: string, sourceAgentId: string) =>
      coordinator.start(roleSetting, sourceAgentId),
    [coordinator],
  );
  const cancel = useCallback(() => coordinator.cancel(), [coordinator]);
  const reset = useCallback(() => coordinator.reset(), [coordinator]);

  return {
    status,
    isActive: status.kind === "matching" || status.kind === "connecting",
    start,
    cancel,
    reset,
  };
}
