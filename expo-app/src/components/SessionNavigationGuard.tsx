import { router, useSegments } from "expo-router";
import { useEffect } from "react";

import { useAuth } from "@/providers/AuthProvider";
import { sessionRedirectPath } from "@/services/auth/splashPolicy";

export function SessionNavigationGuard() {
  const { isBootstrapping, user } = useAuth();
  const segments = useSegments();

  useEffect(() => {
    const target = sessionRedirectPath(isBootstrapping, Boolean(user), segments[0]);
    if (target) router.replace(target);
  }, [isBootstrapping, segments, user]);

  return null;
}
