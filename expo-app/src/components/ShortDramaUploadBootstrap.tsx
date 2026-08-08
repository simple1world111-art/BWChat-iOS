import { useEffect } from "react";

import { useAuth } from "@/providers/AuthProvider";
import { resumeShortDramaUploads } from "@/services/short-drama/ShortDramaUploadQueue";

export function ShortDramaUploadBootstrap() {
  const { user } = useAuth();
  const ownerId = user?.user_id ?? "";

  useEffect(() => {
    if (ownerId) void resumeShortDramaUploads(ownerId);
  }, [ownerId]);

  return null;
}
