import { router, usePathname, useSegments } from "expo-router";
import { useEffect } from "react";

import { useAuth } from "@/providers/AuthProvider";
import { sessionRedirectPath } from "@/services/auth/splashPolicy";

export function SessionNavigationGuard() {
  const { isBootstrapping, user } = useAuth();
  const segments = useSegments();
  const pathname = usePathname();

  useEffect(() => {
    const target = sessionRedirectPath(isBootstrapping, Boolean(user), segments[0], pathname);
    if (target) router.replace(target);
  }, [isBootstrapping, pathname, segments, user]);

  return null;
}
