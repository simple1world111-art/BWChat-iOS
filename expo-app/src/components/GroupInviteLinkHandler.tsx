import * as Linking from "expo-linking";
import { type Href } from "expo-router";
import { useEffect, useRef } from "react";

import { useAuth } from "@/providers/AuthProvider";
import { useRemoteConfig } from "@/providers/RemoteConfigProvider";
import { groupInviteRouteEnabled, groupInviteToken } from "@/services/groups/GroupInviteRoute";
import { selectMainTabThenPush } from "@/services/main-tab/MainTabNavigation";

export function GroupInviteLinkHandler() {
  const { user } = useAuth();
  const { config } = useRemoteConfig();
  const pendingRef = useRef<InviteDelivery | undefined>(undefined);
  const userIdRef = useRef<string | undefined>(undefined);
  const enabledRef = useRef(false);
  const sequenceRef = useRef(0);
  const initialURLReadRef = useRef(false);
  const ownerId = user?.user_id;

  useEffect(() => {
    userIdRef.current = ownerId;
    enabledRef.current = Boolean(ownerId && groupInviteRouteEnabled(config, ownerId));
    const pending = pendingRef.current;
    if (!pending || !ownerId) return;
    pendingRef.current = undefined;
    if (!enabledRef.current) return;
    routeInvite(pending);
  }, [config, ownerId]);

  useEffect(() => {
    const acceptURL = (url: string | null) => {
      if (!url) return;
      const token = groupInviteToken(url);
      if (!token) return;
      const delivery = { token, id: String(++sequenceRef.current) };
      if (!userIdRef.current) {
        pendingRef.current = delivery;
        return;
      }
      pendingRef.current = undefined;
      if (!enabledRef.current) return;
      routeInvite(delivery);
    };
    if (!initialURLReadRef.current) {
      initialURLReadRef.current = true;
      void Linking.getInitialURL().then(acceptURL);
    }
    const subscription = Linking.addEventListener("url", ({ url }) => acceptURL(url));
    return () => subscription.remove();
  }, []);

  return null;
}

interface InviteDelivery {
  token: string;
  id: string;
}

function routeInvite(delivery: InviteDelivery): void {
  selectMainTabThenPush("messages", {
    pathname: "/group-invite-preview",
    params: { token: delivery.token, delivery: delivery.id },
  } as unknown as Href);
}
