import { useMemo } from "react";

import { useRemoteConfig } from "@/providers/RemoteConfigProvider";
import { featureFlagEnabled } from "@/services/remote-config/RemoteConfigService";

export interface ChatMessageActionFeatures {
  localDeleteEnabled: boolean;
  multiselectEnabled: boolean;
  forwardingEnabled: boolean;
  multiForwardingEnabled: boolean;
  mergedForwardingEnabled: boolean;
  recallEnabled: boolean;
}

export function useChatMessageActionFeatures(ownerId: string): ChatMessageActionFeatures {
  const { config } = useRemoteConfig();
  return useMemo(
    () => ({
      localDeleteEnabled: featureFlagEnabled(config, "chat_local_delete_v1", ownerId, true),
      multiselectEnabled: featureFlagEnabled(config, "chat_multiselect_v1", ownerId, true),
      forwardingEnabled: featureFlagEnabled(config, "message_forward_single_v1", ownerId, true),
      multiForwardingEnabled: featureFlagEnabled(config, "message_forward_multi_v1", ownerId, true),
      mergedForwardingEnabled: featureFlagEnabled(
        config,
        "message_forward_merged_create_v1",
        ownerId,
        true,
      ),
      recallEnabled: featureFlagEnabled(config, "message_recall_v1", ownerId, true),
    }),
    [config, ownerId],
  );
}
