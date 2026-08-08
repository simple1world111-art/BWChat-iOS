import AsyncStorage from "@react-native-async-storage/async-storage";

import { getScriptCategories, getScripts } from "@/api/bwchat";
import { apiRequest } from "@/api/client";
import {
  normalizeInteractiveScript,
  normalizeScriptCategories,
  normalizeScriptPage,
} from "@/api/normalizers";
import type { InteractiveScript } from "@/models";
import {
  invalidateScriptCatalog,
  loadCachedScriptCategories,
  loadCachedScriptPage,
  saveCachedScriptCategories,
  saveCachedScriptPage,
  scriptCatalogGeneration,
  scriptCategoriesCacheKey,
  scriptPageCacheKey,
  subscribeScriptLibraryChanges,
} from "@/services/scripts/ScriptCatalogRepository";
import {
  appendUniqueScripts,
  scriptBadgeText,
  scriptCenterMetrics,
  scriptCoverAspectRatio,
  scriptText,
} from "@/services/scripts/scriptCenterPolicy";

jest.mock("@/api/client", () => ({
  APIError: class APIError extends Error {},
  apiRequest: jest.fn(),
}));

const request = jest.mocked(apiRequest);

describe("native ScriptCenterView contracts", () => {
  beforeEach(async () => {
    request.mockReset();
    await AsyncStorage.clear();
  });

  it("keeps the source segmented, category, grid, card, empty and pagination geometry", () => {
    expect(scriptCenterMetrics).toMatchObject({
      segmentedWidth: 196,
      segmentedFontSize: 17,
      createIconSize: 18,
      createButtonSize: 34,
      categoryGap: 8,
      categoryHorizontalOuterInset: 16,
      categoryTopInset: 10,
      categoryBottomInset: 12,
      categoryHorizontalInset: 13,
      categoryVerticalInset: 7,
      gridColumns: 2,
      gridGap: 12,
      gridHorizontalInset: 16,
      skeletonCount: 6,
      cardGap: 9,
      cardInset: 10,
      cardRadius: 15,
      coverAspectRatio: 0.82,
      coverRadius: 12,
      synopsisMinimumHeight: 32,
      roleAvatarSize: 22,
      roleAvatarOverlap: -5,
      roleAvatarStroke: 1.5,
      emptyIconSize: 36,
      pageLimit: 20,
    });
  });

  it("normalizes numeric IDs, legacy aliases and sorted categories", () => {
    const page = normalizeScriptPage({
      scripts: [
        {
          script_id: 123,
          title: "失落星港",
          intro: "两名船员抵达失联多年的星港。",
          cover: "/cover.jpg",
          category_ids: [8, 3],
          visibility: "public",
          status: "ready",
          author: { id: "u1", name: "作者", avatar: "/author.jpg" },
          characters: [{ id: 1, name: "林夏", public_description: "工程师" }],
        },
      ],
      has_more: true,
      next_cursor: "next",
    });
    expect(page).toMatchObject({ has_more: true, next_cursor: "next" });
    expect(page.scripts[0]).toMatchObject({
      script_id: "123",
      synopsis: "两名船员抵达失联多年的星港。",
      category_ids: ["8", "3"],
      creator: { user_id: "u1", nickname: "作者" },
    });
    expect(page.scripts[0]?.roles[0]).toMatchObject({ role_id: "1", name: "林夏" });
    expect(
      normalizeScriptCategories({
        items: [
          { category_id: "b", title: "后", order: 20 },
          { id: "a", name: "前", sort_order: 10 },
        ],
      }).map((category) => category.id),
    ).toEqual(["a", "b"]);
    expect(normalizeScriptPage([makeScript("array")])).toMatchObject({ has_more: false });
  });

  it("matches the native decoder's raw strings, Foundation blanks and exact enums", () => {
    const decoded = normalizeInteractiveScript({
      script_id: " id-with-padding ",
      title: " title-with-padding ",
      synopsis: " synopsis-with-padding ",
      visibility: "PUBLIC",
      status: "READY",
      creator: "invalid",
      author: { id: 7, name: " author " },
      roles: ["invalid"],
      characters: [{ id: 9, name: " role ", hidden_setting: "" }],
      category_ids: [1, "mixed"],
      category_id: " fallback-category ",
      world_setting: "",
      hidden_reason: "",
      is_admin_hidden: "garbage",
    });
    expect(decoded).toMatchObject({
      script_id: " id-with-padding ",
      title: " title-with-padding ",
      synopsis: " synopsis-with-padding ",
      visibility: "private",
      status: "draft",
      creator: { user_id: "7", nickname: " author " },
      category_ids: [" fallback-category "],
      world_setting: "",
      hidden_reason: "",
      is_admin_hidden: false,
    });
    expect(decoded.roles).toEqual([
      expect.objectContaining({ role_id: "9", name: " role ", hidden_setting: "" }),
    ]);
    expect(() => normalizeInteractiveScript({ script_id: "\u200B", title: "valid" })).toThrow(
      "script_id",
    );
    expect(() => normalizeInteractiveScript({ script_id: "valid", title: "\u200B" })).toThrow(
      "title",
    );
    expect(() => normalizeInteractiveScript({ scriptID: "camel-only", title: "valid" })).toThrow(
      "script_id",
    );
  });

  it("uses native category fallback decoding and page-key presence rules", () => {
    expect(
      normalizeScriptCategories({
        categories: ["invalid"],
        items: [
          { id: "", name: "empty-id", sort_order: " 1 " },
          { id: "b", name: "B", sort_order: "2" },
          { id: "a", name: "A", sort_order: 2 },
        ],
      }),
    ).toEqual([
      expect.objectContaining({ id: "", sort_order: 0 }),
      expect.objectContaining({ id: "a", sort_order: 2 }),
      expect.objectContaining({ id: "b", sort_order: 2 }),
    ]);
    expect(() =>
      normalizeScriptPage({ scripts: null, items: [makeScript("must-not-fallback")] }),
    ).toThrow("scripts");
    expect(normalizeScriptPage({ scripts: [], has_more: "unexpected", next_cursor: "" })).toEqual({
      scripts: [],
      has_more: false,
      next_cursor: "",
    });
  });

  it("uses the exact hidden, status and visibility badge precedence", () => {
    expect(scriptBadgeText(makeScript("plain"), "zh-Hans")).toBeNull();
    expect(scriptBadgeText({ ...makeScript("private"), visibility: "private" }, "system")).toBe(
      "私人",
    );
    expect(scriptBadgeText({ ...makeScript("draft"), status: "draft" }, "en")).toBe("Draft");
    expect(
      scriptBadgeText({ ...makeScript("hidden"), status: "draft", is_admin_hidden: true }, "en"),
    ).toBe("Hidden");
    expect(scriptText("system", "公开剧本", "Public")).toBe("公开剧本");
    expect(scriptText("ja", "公开剧本", "Public")).toBe("Public");
  });

  it("appends only new scripts and keeps first-page order stable", () => {
    expect(
      appendUniqueScripts(
        [makeScript("a"), makeScript("b")],
        [makeScript("b"), makeScript("c")],
      ).map((script) => script.script_id),
    ).toEqual(["a", "b", "c"]);
  });

  it("uses the loaded cover's intrinsic ratio and the native 0.82 loading fallback", () => {
    expect(scriptCoverAspectRatio(1080, 1920)).toBe(0.5625);
    expect(scriptCoverAspectRatio(1024, 1536)).toBeCloseTo(2 / 3);
    expect(scriptCoverAspectRatio(0, 1536)).toBe(scriptCenterMetrics.coverAspectRatio);
    expect(scriptCoverAspectRatio(Number.NaN, 1536)).toBe(scriptCenterMetrics.coverAspectRatio);
  });

  it("uses one-hour categories, five-minute pages and 90-day stale retention", async () => {
    const now = Date.UTC(2026, 7, 7);
    const categories = [{ id: "story", name: "故事", sort_order: 1 }];
    const page = { scripts: [makeScript("a")], has_more: false };
    await saveCachedScriptCategories("owner-a", categories, now);
    await saveCachedScriptPage("owner-a", "public", undefined, page, now);
    expect(scriptCategoriesCacheKey("owner-a")).toBe(
      "bwchat.script-catalog-v1:account:owner-a:scripts:categories",
    );
    expect(scriptPageCacheKey("owner-a", "mine", "科幻/悬疑")).toBe(
      "bwchat.script-catalog-v1:account:owner-a:scripts:list-v3:mine:%E7%A7%91%E5%B9%BB%2F%E6%82%AC%E7%96%91",
    );
    expect(scriptCategoriesCacheKey("\u200B")).toBe("");
    expect(scriptCategoriesCacheKey("\uFEFF")).toBe(
      "bwchat.script-catalog-v1:account:%EF%BB%BF:scripts:categories",
    );
    expect(scriptPageCacheKey("owner-a", "public", " category ")).toContain(
      "scripts:list-v3:public:%20category%20",
    );
    expect((await loadCachedScriptCategories("owner-a", now + 3_599_999))?.isStale).toBe(false);
    expect((await loadCachedScriptCategories("owner-a", now + 3_600_000))?.isStale).toBe(true);
    expect(
      (await loadCachedScriptPage("owner-a", "public", undefined, now + 299_999))?.isStale,
    ).toBe(false);
    expect(
      (await loadCachedScriptPage("owner-a", "public", undefined, now + 300_000))?.isStale,
    ).toBe(true);
    expect(await loadCachedScriptPage("owner-b", "public", undefined, now)).toBeNull();
    expect(
      await loadCachedScriptPage(
        "owner-a",
        "public",
        undefined,
        now +
          scriptCenterMetrics.pageTtlMilliseconds +
          scriptCenterMetrics.staleRetentionMilliseconds +
          1,
      ),
    ).toBeNull();
  });

  it("invalidates all account selections and publishes one library-change event", async () => {
    await saveCachedScriptCategories("owner-a", [{ id: "one", name: "One", sort_order: 1 }]);
    await saveCachedScriptPage("owner-a", "public", undefined, { scripts: [], has_more: false });
    await saveCachedScriptPage("owner-a", "mine", "one", { scripts: [], has_more: false });
    await saveCachedScriptPage("owner-b", "public", undefined, { scripts: [], has_more: false });
    let ownerAEvents = 0;
    let ownerBEvents = 0;
    const unsubscribeA = subscribeScriptLibraryChanges("owner-a", () => {
      ownerAEvents += 1;
    });
    const unsubscribeB = subscribeScriptLibraryChanges("owner-b", () => {
      ownerBEvents += 1;
    });
    await invalidateScriptCatalog("owner-a");
    unsubscribeA();
    unsubscribeB();
    expect(ownerAEvents).toBe(1);
    expect(ownerBEvents).toBe(0);
    expect(await loadCachedScriptPage("owner-a", "public")).toBeNull();
    expect(await loadCachedScriptPage("owner-a", "mine", "one")).toBeNull();
    expect(await loadCachedScriptPage("owner-b", "public")).not.toBeNull();
    expect(await loadCachedScriptCategories("owner-a")).not.toBeNull();
  });

  it("rejects corrupt snapshots and prevents invalidated writes from reviving", async () => {
    const owner = "owner-generation";
    const key = scriptPageCacheKey(owner, "public");
    await AsyncStorage.setItem(
      key,
      JSON.stringify({
        value: { scripts: "not-an-array", has_more: false },
        updatedAt: 10,
        expiresAt: Date.now() + 1000,
      }),
    );
    await expect(loadCachedScriptPage(owner, "public")).resolves.toBeNull();
    await expect(AsyncStorage.getItem(key)).resolves.toBeNull();

    const staleGeneration = scriptCatalogGeneration(owner);
    await invalidateScriptCatalog(owner);
    await saveCachedScriptPage(
      owner,
      "public",
      undefined,
      { scripts: [makeScript("late")], has_more: false },
      Date.now(),
      staleGeneration,
    );
    await expect(loadCachedScriptPage(owner, "public")).resolves.toBeNull();
  });

  it("still publishes the authoritative library change when cache cleanup fails", async () => {
    const getAllKeys = jest
      .spyOn(AsyncStorage, "getAllKeys")
      .mockRejectedValueOnce(new Error("storage unavailable"));
    const changes: (InteractiveScript | string | undefined)[] = [];
    const script = makeScript("saved");
    const unsubscribe = subscribeScriptLibraryChanges("owner-a", (change) => changes.push(change));
    await expect(invalidateScriptCatalog("owner-a", script)).resolves.toBeUndefined();
    unsubscribe();
    getAllKeys.mockRestore();
    expect(changes).toEqual([script]);
  });

  it("uses the exact categories and ordered script query routes", async () => {
    request
      .mockResolvedValueOnce({ categories: [{ id: "story", name: "故事", sort_order: 1 }] })
      .mockResolvedValueOnce({ scripts: [makeScript("a")], has_more: false })
      .mockResolvedValueOnce({ scripts: [], has_more: false })
      .mockResolvedValueOnce({ scripts: [], has_more: false })
      .mockResolvedValueOnce({ scripts: [], has_more: false });
    await getScriptCategories();
    await getScripts("public");
    await getScripts("mine", { categoryId: "科幻/悬疑", cursor: "next value", limit: 99 });
    await getScripts("mine", { categoryId: " spaced category ", cursor: "\uFEFF" });
    await getScripts("public", { categoryId: "\u200B", cursor: "\u200B" });
    expect(request.mock.calls).toEqual([
      ["/scripts/categories", { requiredData: true, requiredEnvelope: true }],
      ["/scripts?scope=public&limit=20", { requiredData: true, requiredEnvelope: true }],
      [
        "/scripts?scope=mine&limit=50&category_id=%E7%A7%91%E5%B9%BB%2F%E6%82%AC%E7%96%91&cursor=next+value",
        { requiredData: true, requiredEnvelope: true },
      ],
      [
        "/scripts?scope=mine&limit=20&category_id=+spaced+category+&cursor=%EF%BB%BF",
        { requiredData: true, requiredEnvelope: true },
      ],
      ["/scripts?scope=public&limit=20", { requiredData: true, requiredEnvelope: true }],
    ]);
  });

  it("rejects scripts without the same required identifiers as the native decoder", () => {
    expect(() => normalizeInteractiveScript({ title: "无 ID" })).toThrow("script_id");
    expect(() => normalizeInteractiveScript({ script_id: "id" })).toThrow("title");
  });
});

function makeScript(id: string): InteractiveScript {
  return {
    script_id: id,
    title: `剧本-${id}`,
    synopsis: "这是一段剧情简介。",
    cover_url: "/cover.jpg",
    category_ids: [],
    visibility: "public",
    status: "ready",
    creator: { user_id: "creator", nickname: "作者", avatar_url: "" },
    roles: [],
    is_admin_hidden: false,
  };
}
