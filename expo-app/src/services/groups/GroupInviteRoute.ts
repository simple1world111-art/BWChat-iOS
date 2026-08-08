import { featureFlagEnabled } from "@/services/remote-config/RemoteConfigService";
import type { RemoteConfig } from "@/services/remote-config/types";

const allowedToken = /^[A-Za-z0-9._-]{8,512}$/u;

export function isGroupInviteToken(value: string): boolean {
  return allowedToken.test(value);
}

export function groupInviteRouteEnabled(config: RemoteConfig, ownerId: string): boolean {
  return (
    featureFlagEnabled(config, "group_info_v2", ownerId, true) &&
    featureFlagEnabled(config, "group_invite_qr_v1", ownerId, false)
  );
}

export function groupInviteToken(urlString: string): string | null {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return null;
  }
  const components = url.pathname.split("/").filter(Boolean);
  let candidate: string | undefined;
  if (url.protocol.toLowerCase() === "bwchat:" && url.hostname.toLowerCase() === "group-invite") {
    candidate = components[0];
  } else if (url.protocol.toLowerCase() === "https:") {
    if (components.length >= 2 && components[0] === "group-invites") {
      candidate = components[1];
    } else if (components.length >= 3 && components[0] === "join" && components[1] === "group") {
      candidate = components[2];
    }
  }
  if (!candidate) return null;
  try {
    const decoded = decodeURIComponent(candidate);
    return isGroupInviteToken(decoded) ? decoded : null;
  } catch {
    return null;
  }
}
