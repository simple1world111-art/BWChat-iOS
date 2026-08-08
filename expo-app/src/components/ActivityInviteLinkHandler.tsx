import * as Linking from "expo-linking";
import { type Href } from "expo-router";
import { useEffect, useRef } from "react";

import { useAuth } from "@/providers/AuthProvider";
import { activityInviteToken } from "@/services/activity/ActivityCenterRepository";
import { selectMainTabThenPush } from "@/services/main-tab/MainTabNavigation";

export function ActivityInviteLinkHandler() {
  const { user } = useAuth();
  const pendingRef = useRef<InviteDelivery | undefined>(undefined);
  const userIDRef = useRef<string | undefined>(undefined);
  const deliverySequenceRef = useRef(0);
  const initialURLReadRef = useRef(false);

  useEffect(() => {
    userIDRef.current = user?.user_id;
    const pending = pendingRef.current;
    if (!pending || !user?.user_id) return;
    pendingRef.current = undefined;
    routeInviteDelivery(pending);
  }, [user?.user_id]);

  useEffect(() => {
    const acceptURL = (url: string | null) => {
      if (!url) return;
      const token = activityInviteToken(url);
      if (!token) return;
      const delivery = { token, id: String(++deliverySequenceRef.current) };
      if (!userIDRef.current) {
        pendingRef.current = delivery;
        return;
      }
      pendingRef.current = undefined;
      routeInviteDelivery(delivery);
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

function routeInviteDelivery(delivery: InviteDelivery) {
  selectMainTabThenPush("discover", {
    pathname: "/activity-center",
    params: { inviteToken: delivery.token, inviteDelivery: delivery.id },
  } as unknown as Href);
}
