import AsyncStorage from "@react-native-async-storage/async-storage";

import { createScriptRoom, deleteScript, getScript, updateScript } from "@/api/bwchat";
import { apiRequest } from "@/api/client";
import type { InteractiveScript } from "@/models";
import {
  clearPendingScriptForNavigation,
  pendingScriptForNavigation,
  rememberScriptForNavigation,
} from "@/services/scripts/ScriptNavigationStore";
import {
  canStartScript,
  isScriptOwner,
  scriptDetailCoverAspectRatio,
  scriptDetailMetrics,
  scriptDetailStatusBadges,
  scriptGenderText,
  selectedRoleById,
} from "@/services/scripts/scriptDetailPolicy";

jest.mock("@/api/client", () => ({
  APIError: class APIError extends Error {},
  apiRequest: jest.fn(),
}));

const request = jest.mocked(apiRequest);

describe("native ScriptDetailView contracts", () => {
  beforeEach(async () => {
    request.mockReset();
    await AsyncStorage.clear();
    clearPendingScriptForNavigation("script-1", "owner-a");
  });

  it("keeps source cover, section, role, action, start bar and sheet geometry", () => {
    expect(scriptDetailMetrics).toMatchObject({
      contentGap: 18,
      contentHorizontalInset: 16,
      contentBottomInset: 110,
      coverTopInset: 12,
      coverAspectRatio: 1.55,
      coverRadius: 18,
      coverTextInset: 16,
      coverTitleSize: 25,
      sectionInset: 16,
      sectionRadius: 16,
      statusGap: 8,
      statusFontSize: 11,
      roleAvatarSize: 48,
      actionDividerInset: 46,
      startVerticalInset: 13,
      startRadius: 13,
      roleInfoAvatarSize: 92,
      roleInfoOuterInset: 20,
      selectionGap: 10,
      selectionRoleInset: 12,
      selectionRoleRadius: 14,
      selectionCheckSize: 22,
      roomNavigationDelayMilliseconds: 250,
      toastMilliseconds: 3_000,
    });
  });

  it("uses the loaded poster's intrinsic ratio while retaining the native source fallback", () => {
    expect(scriptDetailCoverAspectRatio(1_024, 1_536)).toBeCloseTo(2 / 3);
    expect(scriptDetailCoverAspectRatio(1_080, 1_920)).toBe(0.5625);
    expect(scriptDetailCoverAspectRatio(0, 1_536)).toBe(scriptDetailMetrics.coverAspectRatio);
    expect(scriptDetailCoverAspectRatio(Number.NaN, 1_536)).toBe(
      scriptDetailMetrics.coverAspectRatio,
    );
  });

  it("matches owner, start gate and role lookup behavior", () => {
    const script = makeScript();
    expect(isScriptOwner(script, "owner-1")).toBe(true);
    expect(isScriptOwner(script, "other")).toBe(false);
    expect(canStartScript(script, false)).toBe(true);
    expect(canStartScript({ ...script, roles: script.roles.slice(0, 1) }, false)).toBe(false);
    expect(canStartScript({ ...script, status: "draft" }, false)).toBe(false);
    expect(canStartScript({ ...script, is_admin_hidden: true }, false)).toBe(false);
    expect(canStartScript(script, true)).toBe(false);
    expect(selectedRoleById(script, "role-2")?.name).toBe("陆沉舟");
  });

  it("keeps status, visibility and admin badge order and gender localization", () => {
    expect(scriptDetailStatusBadges(makeScript(), "zh-Hans")).toEqual([
      { id: "status", text: "可开局", tone: "accent" },
      { id: "visibility", text: "公开", tone: "success" },
    ]);
    expect(
      scriptDetailStatusBadges(
        { ...makeScript(), visibility: "private", is_admin_hidden: true },
        "en",
      ),
    ).toEqual([
      { id: "status", text: "Ready", tone: "accent" },
      { id: "visibility", text: "Private", tone: "secondary" },
      { id: "admin", text: "Admin hidden", tone: "danger" },
    ]);
    expect(scriptGenderText("system", "female")).toBe("女");
    expect(scriptGenderText("en", "nonbinary")).toBe("Non-binary");
    expect(scriptGenderText("ja", "unknown")).toBe("Unspecified");
  });

  it("keeps private navigation hand-off owner-scoped and non-resurrecting", () => {
    const script = { ...makeScript(), visibility: "private" as const };
    rememberScriptForNavigation(script, "owner-a");
    expect(pendingScriptForNavigation("script-1", "owner-a")).toBe(script);
    expect(pendingScriptForNavigation("other", "owner-a")).toBeNull();
    clearPendingScriptForNavigation("other", "owner-a");
    expect(pendingScriptForNavigation("script-1", "owner-a")).toBe(script);

    clearPendingScriptForNavigation("script-1", "owner-b");
    expect(pendingScriptForNavigation("script-1", "owner-a")).toBe(script);
    expect(pendingScriptForNavigation("script-1", "owner-b")).toBeNull();
    expect(pendingScriptForNavigation("script-1", "owner-a")).toBeNull();

    rememberScriptForNavigation(script, "owner-a");
    clearPendingScriptForNavigation("script-1", "owner-a");
    expect(pendingScriptForNavigation("script-1", "owner-a")).toBeNull();

    rememberScriptForNavigation(script, "\u200B");
    expect(pendingScriptForNavigation("script-1", "\u200B")).toBeNull();
    rememberScriptForNavigation(script, "\uFEFF");
    expect(pendingScriptForNavigation("script-1", "\uFEFF")).toBe(script);
    clearPendingScriptForNavigation("script-1", "\uFEFF");
  });

  it("uses exact get, visibility patch and delete routes", async () => {
    request
      .mockResolvedValueOnce({ script: makeScript() })
      .mockResolvedValueOnce({ script: { ...makeScript(), visibility: "private" } })
      .mockResolvedValueOnce(null);
    expect((await getScript("script/1")).script_id).toBe("script-1");
    expect((await updateScript("script/1", { visibility: "private" })).visibility).toBe("private");
    await deleteScript("script/1");
    expect(request.mock.calls).toEqual([
      ["/scripts/script%2F1", { requiredData: true, requiredEnvelope: true }],
      [
        "/scripts/script%2F1",
        {
          method: "PATCH",
          requiredData: true,
          requiredEnvelope: true,
          body: { visibility: "private" },
        },
      ],
      ["/scripts/script%2F1", { method: "DELETE", requiredEnvelope: true }],
    ]);
  });

  it("creates a room with the original player body and Idempotency-Key", async () => {
    request.mockResolvedValueOnce({
      room: {
        room_id: "room-1",
        script_id: "script-1",
        group_id: 42,
        status: "active",
        player_role_id: "role-1",
        assignments: [],
        script_snapshot: { title: "失落星港", synopsis: "", cover_url: "", roles: [] },
      },
      conversation: {
        type: "group",
        id: "42",
        group_id: 42,
        name: "失落星港",
        conversation_kind: "script_room",
        script_room_id: "room-1",
      },
    });
    const result = await createScriptRoom("script/1", "role/1", "idem-1");
    expect(result.room).toMatchObject({ room_id: "room-1", group_id: 42 });
    expect(result.conversation).toMatchObject({ id: "42", script_room_id: "room-1" });
    expect(request).toHaveBeenCalledWith("/scripts/script%2F1/rooms", {
      method: "POST",
      headers: { "Idempotency-Key": "idem-1" },
      body: { player_role_id: "role/1" },
      requiredData: true,
      requiredEnvelope: true,
    });
  });
});

function makeScript(): InteractiveScript {
  return {
    script_id: "script-1",
    title: "失落星港",
    synopsis: "两名船员抵达失联多年的星港。",
    cover_url: "/cover.jpg",
    category_ids: ["science_fiction"],
    visibility: "public",
    status: "ready",
    creator: { user_id: "owner-1", nickname: "作者", avatar_url: "" },
    roles: [
      {
        role_id: "role-1",
        name: "林夏",
        gender: "female",
        avatar_url: "/one.jpg",
        description: "工程师",
        sort_order: 0,
      },
      {
        role_id: "role-2",
        name: "陆沉舟",
        gender: "male",
        avatar_url: "/two.jpg",
        description: "领航员",
        sort_order: 1,
      },
    ],
    is_admin_hidden: false,
  };
}
