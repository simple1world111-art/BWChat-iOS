import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  groupInviteRouteEnabled,
  groupInviteToken,
  isGroupInviteToken,
} from "@/services/groups/GroupInviteRoute";
import { defaultRemoteConfig } from "@/services/remote-config/RemoteConfigService";

describe("native group invite deep-link routing", () => {
  it("accepts every native URL shape and decodes the validated token", () => {
    expect(groupInviteToken("bwchat://group-invite/abcDEF_123-xyz")).toBe("abcDEF_123-xyz");
    expect(groupInviteToken("https://example.com/group-invites/abcDEF_123-xyz")).toBe(
      "abcDEF_123-xyz",
    );
    expect(groupInviteToken("https://example.com/join/group/abcDEF_123-xyz")).toBe(
      "abcDEF_123-xyz",
    );
    expect(groupInviteToken("https://example.com/group-invites/abcDEF%5F123-xyz")).toBe(
      "abcDEF_123-xyz",
    );
  });

  it("rejects wrong schemes, malformed escapes, traversal and invalid lengths", () => {
    expect(groupInviteToken("http://example.com/group-invites/abcDEF_123-xyz")).toBeNull();
    expect(groupInviteToken("bwchat://invite/abcDEF_123-xyz")).toBeNull();
    expect(groupInviteToken("bwchat://group-invite/a%2Fb12345678")).toBeNull();
    expect(groupInviteToken("bwchat://group-invite/%E0%A4%A")).toBeNull();
    expect(groupInviteToken("bwchat://group-invite/short")).toBeNull();
    expect(isGroupInviteToken("abcDEF_123-xyz")).toBe(true);
    expect(isGroupInviteToken("short")).toBe(false);
  });

  it("requires both native deep-link feature flags after authentication", () => {
    expect(groupInviteRouteEnabled(defaultRemoteConfig, "owner-a")).toBe(false);
    expect(
      groupInviteRouteEnabled(
        {
          ...defaultRemoteConfig,
          featureFlags: [
            { key: "group_info_v2", enabled: true },
            { key: "group_invite_qr_v1", enabled: true },
          ],
        },
        "owner-a",
      ),
    ).toBe(true);
    expect(
      groupInviteRouteEnabled(
        {
          ...defaultRemoteConfig,
          featureFlags: [
            { key: "group_info_v2", enabled: false },
            { key: "group_invite_qr_v1", enabled: true },
          ],
        },
        "owner-a",
      ),
    ).toBe(false);
  });

  it("mounts the cold/hot link handler before the app stack and keeps a delivery nonce", () => {
    const layout = readFileSync(resolve(__dirname, "../src/app/_layout.tsx"), "utf8");
    const handler = readFileSync(
      resolve(__dirname, "../src/components/GroupInviteLinkHandler.tsx"),
      "utf8",
    );
    expect(layout).toContain("<GroupInviteLinkHandler />");
    expect(layout.indexOf("<RemoteConfigProvider>")).toBeLessThan(
      layout.indexOf("<GroupInviteLinkHandler />"),
    );
    expect(handler).toContain("Linking.getInitialURL()");
    expect(handler).toContain('Linking.addEventListener("url"');
    expect(handler).toContain('pathname: "/group-invite-preview"');
    expect(handler).toContain("delivery: delivery.id");
    expect(handler).toContain("groupInviteRouteEnabled(config, ownerId)");
  });
});
