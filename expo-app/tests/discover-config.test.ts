import {
  defaultDiscoverSections,
  discoverItemTitle,
  effectiveDiscoverSections,
  normalizeDiscoverColor,
  parseDiscoverConfig,
} from "@/services/discover/DiscoverConfig";
import {
  discoverConfigMinimumRefreshIntervalMs,
  discoverRefreshMayCommit,
  shouldFetchDiscoverConfig,
} from "@/services/discover/DiscoverRefreshPolicy";

describe("Discover config parity", () => {
  it("reproduces the seven native default entries and stable blocks", () => {
    expect(defaultDiscoverSections.map((section) => section.items.map((item) => item.id))).toEqual([
      ["moments"],
      ["games", "stories", "short_drama", "live"],
      ["groups"],
      ["benefits"],
    ]);
  });

  it("normalizes snake_case and removes disabled and moved map entries", () => {
    const config = parseDiscoverConfig({
      schema_version: 2,
      sections: [
        {
          id: "mixed",
          order: 5,
          items: [
            { id: "map_dating", order: 1 },
            { id: "custom", title_i18n: { en: "Custom" }, system_image: "star.fill", order: 3 },
            { id: "hidden", enabled: false, order: 2 },
            { id: "route_hidden", route: { type: "disabled" }, order: 4 },
          ],
        },
      ],
    });
    expect(config.schemaVersion).toBe(2);
    expect(effectiveDiscoverSections(config)).toEqual([
      expect.objectContaining({
        id: "mixed",
        items: [
          expect.objectContaining({
            id: "custom",
            titleI18n: { en: "Custom" },
            systemImage: "star.fill",
          }),
        ],
      }),
    ]);
  });

  it("moves remote default items back into original sections and fixed item order", () => {
    const sections = effectiveDiscoverSections(
      parseDiscoverConfig({
        sections: [
          {
            id: "remote",
            order: 1,
            items: [
              { id: "benefits", order: 1 },
              { id: "live", order: 2 },
              { id: "moments", order: 3 },
              { id: "games", order: 99 },
            ],
          },
        ],
      }),
    );
    expect(sections.map((section) => [section.id, section.items.map((item) => item.id)])).toEqual([
      ["social", ["moments"]],
      ["entertainment", ["games", "live"]],
      ["benefits", ["benefits"]],
    ]);
  });

  it("prefers native titles for stable live, groups, and benefits identities", () => {
    const t = (key: string) =>
      ({ "discover.live": "聊天", "discover.groups": "群组", "discover.benefits": "活动" })[key] ??
      key;
    expect(discoverItemTitle({ id: "live", title: "Remote live" }, "zh-Hans", t)).toBe("聊天");
    expect(discoverItemTitle({ id: "group-list", title: "Remote groups" }, "zh-Hans", t)).toBe(
      "群组",
    );
    expect(discoverItemTitle({ id: "benefits", title: "Remote benefits" }, "zh-Hans", t)).toBe(
      "活动",
    );
  });

  it("accepts six/eight digit colors and rejects invalid colors", () => {
    expect(normalizeDiscoverColor("#667EEA")).toBe("#667EEA");
    expect(normalizeDiscoverColor("FF8E53FF")).toBe("#FF8E53FF");
    expect(normalizeDiscoverColor("not-a-color")).toBeUndefined();
  });

  it("throttles only discover config while allowing every moments refresh cycle", () => {
    expect(shouldFetchDiscoverConfig({ force: false, nowMs: 10_000, lastAttemptMs: 9_999 })).toBe(
      false,
    );
    expect(
      shouldFetchDiscoverConfig({
        force: false,
        nowMs: discoverConfigMinimumRefreshIntervalMs,
        lastAttemptMs: 0,
      }),
    ).toBe(true);
    expect(shouldFetchDiscoverConfig({ force: true, nowMs: 2, lastAttemptMs: 1 })).toBe(true);
  });

  it("rejects stale discover and moments responses after blur or account switch", () => {
    const current = {
      generation: 3,
      currentGeneration: 3,
      targetOwnerId: "owner-a",
      activeOwnerId: "owner-a",
      focused: true,
    };
    expect(discoverRefreshMayCommit(current)).toBe(true);
    expect(discoverRefreshMayCommit({ ...current, currentGeneration: 4 })).toBe(false);
    expect(discoverRefreshMayCommit({ ...current, activeOwnerId: "owner-b" })).toBe(false);
    expect(discoverRefreshMayCommit({ ...current, focused: false })).toBe(false);
  });
});
