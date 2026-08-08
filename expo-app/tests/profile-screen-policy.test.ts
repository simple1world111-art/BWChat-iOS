import {
  profileLoadCanCommit,
  profileMenuSubtitle,
  profileMenuTitle,
  profileResponseBelongsToOwner,
} from "@/services/profile/ProfileScreenPolicy";

describe("Profile screen owner and remote-content policy", () => {
  const t = (key: string, ...args: (string | number)[]) =>
    args.length > 0 ? `${key}:${args.join(",")}` : `translated:${key}`;

  it("rejects every late response after a generation or account switch", () => {
    expect(
      profileLoadCanCommit({
        generation: 4,
        currentGeneration: 4,
        targetOwnerId: "owner-a",
        activeOwnerId: "owner-a",
      }),
    ).toBe(true);
    expect(
      profileLoadCanCommit({
        generation: 3,
        currentGeneration: 4,
        targetOwnerId: "owner-a",
        activeOwnerId: "owner-a",
      }),
    ).toBe(false);
    expect(
      profileLoadCanCommit({
        generation: 4,
        currentGeneration: 4,
        targetOwnerId: "owner-a",
        activeOwnerId: "owner-b",
      }),
    ).toBe(false);
    expect(
      profileLoadCanCommit({
        generation: 1,
        currentGeneration: 1,
        targetOwnerId: "",
        activeOwnerId: "",
      }),
    ).toBe(false);
  });

  it("commits only a profile returned for the requested owner", () => {
    expect(profileResponseBelongsToOwner(" owner-a ", "owner-a")).toBe(true);
    expect(profileResponseBelongsToOwner("owner-a", "owner-b")).toBe(false);
    expect(profileResponseBelongsToOwner("", "")).toBe(false);
  });

  it("uses the active locale, localization keys and the three native title exceptions", () => {
    expect(
      profileMenuTitle(
        {
          id: "remote",
          titleI18n: { en: "English", ja: "日本語", "zh-Hans": "简体中文" },
        },
        "ja",
        t,
      ),
    ).toBe("日本語");
    expect(profileMenuTitle({ id: "wallet", titleKey: "profile.wallet" }, "en", t)).toBe(
      "translated:profile.wallet",
    );
    expect(profileMenuTitle({ id: "agent_hub", title: "Wrong" }, "en", t)).toBe("智能体");
    expect(profileMenuTitle({ id: "my_short_dramas" }, "en", t)).toBe(
      "translated:shortDrama.title",
    );
    expect(profileMenuTitle({ id: "my_groups" }, "en", t)).toBe("translated:discover.groups");
  });

  it("localizes subtitles and ignores unresolved localization keys", () => {
    expect(
      profileMenuSubtitle(
        { id: "one", subtitleI18n: { en: "Subtitle", "zh-Hans": "副标题" } },
        "zh-CN",
        t,
      ),
    ).toBe("Subtitle");
    expect(
      profileMenuSubtitle(
        { id: "one", subtitleI18n: { en: "Subtitle", "zh-Hans": "副标题" } },
        "zh-Hans",
        t,
      ),
    ).toBe("副标题");
    const unresolved = (key: string) => key;
    expect(
      profileMenuSubtitle(
        { id: "one", subtitleKey: "missing.key", subtitle: "Fallback" },
        "en",
        unresolved,
      ),
    ).toBe("Fallback");
  });
});
