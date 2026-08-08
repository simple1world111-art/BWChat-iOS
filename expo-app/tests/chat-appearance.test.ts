import {
  backgroundImagePath,
  backgroundKey,
  effectiveBackground,
  exactBackground,
  normalizeBackgroundList,
  type ChatBackground,
} from "@/services/chat-appearance/ChatAppearanceService";

describe("native chat background contract", () => {
  const global: ChatBackground = {
    target_type: "global",
    target_id: "global",
    image_url: "backgrounds/global.jpg",
    updated_at: "2026-08-06T10:00:00Z",
  };
  const direct: ChatBackground = {
    target_type: "dm",
    target_id: "friend-1",
    image_url: "/api/v1/backgrounds/friend.jpg",
  };
  const backgrounds = {
    [backgroundKey(global.target_type, global.target_id)]: global,
    [backgroundKey(direct.target_type, direct.target_id)]: direct,
  };

  it("uses exact chat background before the global fallback", () => {
    expect(exactBackground(backgrounds, "dm", "friend-1")).toEqual(direct);
    expect(effectiveBackground(backgrounds, "dm", "friend-1")).toEqual(direct);
    expect(effectiveBackground(backgrounds, "group", "42")).toEqual(global);
    expect(effectiveBackground(backgrounds, "global", "global")).toEqual(global);
  });

  it("decodes only the native snake_case model and rejects the whole malformed list", () => {
    expect(normalizeBackgroundList([global])).toEqual([global]);
    expect(() =>
      normalizeBackgroundList([
        global,
        { targetType: "group", targetId: 42, imageUrl: "groups/42.jpg", updatedAt: "v2" },
      ]),
    ).toThrow("api.decodingError");
    expect(() =>
      normalizeBackgroundList([
        global,
        { target_type: "unknown", target_id: "bad", image_url: "bad.jpg" },
      ]),
    ).toThrow("api.decodingError");
    expect(backgroundImagePath(global)).toBe("/api/v1/backgrounds/global.jpg");
    expect(backgroundImagePath(direct)).toBe("/api/v1/backgrounds/friend.jpg");
  });
});
