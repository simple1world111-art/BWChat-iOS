import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  createScript,
  createScriptRoom,
  deleteScript,
  getScript,
  getScriptCategories,
  getScripts,
  updateScript,
} from "@/api/bwchat";
import { apiRequest } from "@/api/client";
import type { InteractiveScript } from "@/models";

jest.mock("@/api/client", () => ({
  APIError: class APIError extends Error {},
  apiRequest: jest.fn(),
}));

const request = jest.mocked(apiRequest);
const root = resolve(__dirname, "..");

describe("Script Center API contract", () => {
  beforeEach(() => request.mockReset());

  it("locks categories/list/detail/delete to authenticated required envelopes", async () => {
    request
      .mockResolvedValueOnce({ categories: [] })
      .mockResolvedValueOnce({ scripts: [script()], has_more: false })
      .mockResolvedValueOnce({ script: script() })
      .mockResolvedValueOnce(undefined);

    await getScriptCategories();
    await getScripts("mine", { categoryId: "科幻/悬疑", cursor: "next value", limit: 99 });
    await getScript("script/1");
    await deleteScript("script/1");

    expect(request.mock.calls).toEqual([
      ["/scripts/categories", { requiredData: true, requiredEnvelope: true }],
      [
        "/scripts?scope=mine&limit=50&category_id=%E7%A7%91%E5%B9%BB%2F%E6%82%AC%E7%96%91&cursor=next+value",
        { requiredData: true, requiredEnvelope: true },
      ],
      ["/scripts/script%2F1", { requiredData: true, requiredEnvelope: true }],
      ["/scripts/script%2F1", { method: "DELETE", requiredEnvelope: true }],
    ]);
  });

  it("locks create/update bodies and room join idempotency", async () => {
    request
      .mockResolvedValueOnce({ script: script() })
      .mockResolvedValueOnce({ script: { ...script(), visibility: "private" } })
      .mockResolvedValueOnce({ room: room() });

    await createScript({ title: "失落星港", visibility: "public" });
    await updateScript("script/1", { visibility: "private" });
    await createScriptRoom("script/1", "role/1", "stable-idempotency-key");

    expect(request.mock.calls).toEqual([
      [
        "/scripts",
        {
          method: "POST",
          requiredData: true,
          requiredEnvelope: true,
          body: { title: "失落星港", visibility: "public" },
        },
      ],
      [
        "/scripts/script%2F1",
        {
          method: "PATCH",
          requiredData: true,
          requiredEnvelope: true,
          body: { visibility: "private" },
        },
      ],
      [
        "/scripts/script%2F1/rooms",
        {
          method: "POST",
          headers: { "Idempotency-Key": "stable-idempotency-key" },
          body: { player_role_id: "role/1" },
          requiredData: true,
          requiredEnvelope: true,
        },
      ],
    ]);
  });

  it("requires the native ScriptSingleData script field for detail and mutations", async () => {
    request
      .mockResolvedValueOnce(script())
      .mockResolvedValueOnce({ item: script() })
      .mockResolvedValueOnce({ script: script() });

    await expect(getScript("script-1")).rejects.toThrow("缺少 script");
    await expect(createScript({ title: "失落星港" })).rejects.toThrow("缺少 script");
    await expect(updateScript("script-1", { title: "失落星港" })).resolves.toMatchObject({
      script_id: "script-1",
    });
  });

  it("inherits native auth, one refresh and bounded transient retry policy", () => {
    const client = source("src/api/client.ts");
    expect(client).toContain('headers.set("Authorization", `Bearer ${token}`)');
    expect(client).toContain("response.status === 401 && state.canRefresh");
    expect(client).toContain("canRefresh: false, didRefresh: true");
    expect(client).toContain("const transientDelays = [350, 900] as const");
    expect(client).toContain('method === "GET" || method === "HEAD"');
    expect(client).toContain('new Headers(options.headers).has("Idempotency-Key")');
    expect(client).toContain(
      "const retryableStatuses = new Set([408, 425, 429, 500, 502, 503, 504])",
    );
  });

  it("keeps relationship refresh and delayed room navigation after a confirmed join", () => {
    const detail = source("src/app/script-detail.tsx");
    expect(detail).toContain("createScriptRoom(scriptId, roleId, randomUUID().toUpperCase())");
    expect(detail).toContain("saveCachedScriptRoom(ownerId, result.room)");
    expect(detail).toContain("invalidateAgentCatalog(ownerId)");
    expect(detail).toContain('pathname: "/script-room-chat"');
    expect(detail).toContain("scriptDetailMetrics.roomNavigationDelayMilliseconds");
  });
});

function source(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), "utf8");
}

function script(): InteractiveScript {
  return {
    script_id: "script-1",
    title: "失落星港",
    synopsis: "剧情简介",
    cover_url: "",
    category_ids: [],
    visibility: "public",
    status: "ready",
    creator: { user_id: "creator", nickname: "作者", avatar_url: "" },
    roles: [],
    is_admin_hidden: false,
  };
}

function room() {
  return {
    room_id: "room-1",
    script_id: "script-1",
    group_id: 42,
    status: "active",
    player_role_id: "role-1",
    assignments: [],
    script_snapshot: { title: "失落星港", synopsis: "", cover_url: "", roles: [] },
  };
}
