import {
  displayDynamicScreenTitle,
  dynamicInteger,
  isLegalDynamicScreenComplete,
  legalDocumentKind,
  legalDocumentLocaleMatches,
  localizedDynamicProp,
  parseLegalDocumentWire,
  parseDynamicScreen,
  parseDynamicScreenWire,
} from "@/services/dynamic-screen/DynamicScreenModels";

describe("dynamic screen native protocol", () => {
  const fixture = {
    screen_id: "festival_home",
    schema_version: 1,
    config_version: "remote-7",
    title_key: "missing.title.key",
    title_i18n: { "zh-Hans": "节日活动", en: "Festival" },
    refresh_interval_seconds: 180,
    components: [
      {
        id: "hero",
        type: "banner",
        visible: true,
        min_app_version: "1.0",
        props: {
          title: { "zh-Hans": "限时活动", en: "Limited event" },
          height: "160",
          colors: ["FFF4C9", "E9F8FF"],
        },
        action: { type: "screen", screen_id: "daily_rewards" },
        children: [{ id: "body", type: "text", props: { text: "详情" } }],
      },
    ],
  };

  it("decodes the Swift snake_case screen, component and route shape", () => {
    const screen = parseDynamicScreen(fixture);
    expect(screen).toMatchObject({
      screenId: "festival_home",
      schemaVersion: 1,
      configVersion: "remote-7",
      refreshIntervalSeconds: 180,
    });
    expect(screen?.components[0]).toMatchObject({
      id: "hero",
      type: "banner",
      visible: true,
      minAppVersion: "1.0",
      action: { type: "screen", screenId: "daily_rewards" },
    });
    expect(screen?.components[0]?.children?.[0]?.props.text).toBe("详情");
  });

  it("uses the same localized title and JSON conversion fallbacks as Swift", () => {
    const screen = parseDynamicScreen(fixture)!;
    expect(displayDynamicScreenTitle(screen, "zh-Hans", (key) => key)).toBe("节日活动");
    expect(displayDynamicScreenTitle(screen, "de-DE", (key) => key)).toBe("Festival");
    expect(localizedDynamicProp(screen.components[0]!.props, "title", "ja-JP")).toBe(
      "Limited event",
    );
    expect(dynamicInteger(screen.components[0]!.props.height)).toBe(160);
  });

  it("selects exact screen and component copy for all ten native app languages", () => {
    const languages = [
      "en",
      "ja",
      "ko",
      "es",
      "fr",
      "de",
      "pt-BR",
      "ru",
      "zh-Hans",
      "zh-Hant",
    ] as const;
    const values = Object.fromEntries(languages.map((language) => [language, `copy:${language}`]));
    const screen = parseDynamicScreen({
      screen_id: "localized",
      title_i18n: values,
      components: [{ id: "copy", type: "text", props: { title: values } }],
    })!;
    for (const language of languages) {
      expect(displayDynamicScreenTitle(screen, language, (key) => key)).toBe(`copy:${language}`);
      expect(localizedDynamicProp(screen.components[0]!.props, "title", language)).toBe(
        `copy:${language}`,
      );
    }
  });

  it("matches Swift Codable's all-or-nothing structural decoding", () => {
    expect(parseDynamicScreen({ components: [] })).toBeNull();
    const screen = parseDynamicScreen({
      screen_id: "safe",
      components: [{ id: "valid", type: "text", props: {} }, { type: "text" }],
    });
    expect(screen).toBeNull();
    expect(
      parseDynamicScreen({
        screen_id: "safe",
        schema_version: "1",
        components: [],
      }),
    ).toBeNull();
    expect(
      parseDynamicScreen({
        screen_id: "safe",
        components: [{ id: "missing-props", type: "text" }],
      }),
    ).toBeNull();
  });

  it("rejects camelCase aliases on the backend wire while retaining stored projections", () => {
    const stored = {
      screenId: "safe",
      schemaVersion: 1,
      components: [
        {
          id: "row",
          type: "row",
          minAppVersion: "1.0",
          props: {},
          action: { type: "screen", screenId: "next" },
        },
      ],
    };
    expect(parseDynamicScreen(stored)).toMatchObject({ screenId: "safe", schemaVersion: 1 });
    expect(parseDynamicScreenWire(stored)).toBeNull();
    expect(
      parseDynamicScreenWire({
        screen_id: "safe",
        components: [
          {
            id: "row",
            type: "row",
            props: {},
            action: { type: "screen", screenId: "camel-child" },
          },
        ],
      })?.components[0]?.action,
    ).toEqual({ type: "screen" });
    expect(parseDynamicScreenWire(fixture)).toMatchObject({ screenId: "festival_home" });
  });

  it("preserves Swift JSONValue whitespace while still treating blank copy as absent", () => {
    const screen = parseDynamicScreen({
      screen_id: "safe",
      title: "  Screen title  ",
      components: [
        {
          id: "copy",
          type: "text",
          props: { title: "  Body copy  ", subtitle: "   ", system_image: "  " },
        },
      ],
    })!;
    expect(displayDynamicScreenTitle(screen, "en", (key) => key)).toBe("  Screen title  ");
    expect(localizedDynamicProp(screen.components[0]!.props, "title", "en")).toBe("  Body copy  ");
    expect(localizedDynamicProp(screen.components[0]!.props, "subtitle", "en")).toBeUndefined();
  });

  it("adapts the strict legal-document wire shape into a readable SDUI card", () => {
    expect(
      parseLegalDocumentWire({
        screen_id: "privacy_policy",
        document_version: "2026-08-12.1",
        effective_at: "2026-08-12T00:00:00Z",
        locale: "zh-Hans",
        title: "隐私政策",
        body: "仅处理提供服务所必需的数据。",
      }),
    ).toEqual({
      screenId: "privacy_policy",
      configVersion: "2026-08-12.1",
      documentVersion: "2026-08-12.1",
      effectiveAt: "2026-08-12T00:00:00Z",
      locale: "zh-Hans",
      title: "隐私政策",
      components: [
        {
          id: "privacy_policy_document_body",
          type: "text",
          props: { text: "仅处理提供服务所必需的数据。", style: "legal_body" },
        },
      ],
    });
    expect(parseLegalDocumentWire({ screen_id: "privacy_policy", title: "隐私政策" })).toBeNull();
    expect(
      parseLegalDocumentWire({ screenId: "privacy_policy", title: "隐私政策", body: "正文" }),
    ).toBeNull();
  });

  it("reads legal support only from support.email", () => {
    expect(
      parseLegalDocumentWire({
        screen_id: "privacy_policy",
        document_version: "2026-08-12.1",
        effective_at: "2026-08-12T00:00:00Z",
        locale: "en",
        title: "Privacy",
        body: "Complete legal body",
        support_email: "wrong-top@example.com",
        support: { email: " legal@example.com " },
      })?.supportEmail,
    ).toBe("legal@example.com");
    expect(
      parseLegalDocumentWire({
        screen_id: "privacy_policy",
        document_version: "2026-08-12.1",
        effective_at: "2026-08-12T00:00:00Z",
        locale: "en",
        title: "Privacy",
        body: "Complete legal body",
        support: { support_email: "wrong@example.com" },
      })?.supportEmail,
    ).toBeUndefined();
  });

  it("rejects only incomplete compliance documents without changing ordinary SDUI", () => {
    const placeholder = parseLegalDocumentWire({
      screen_id: "privacy_policy",
      document_version: "2026-08-12.1",
      effective_at: "2026-08-12T00:00:00Z",
      locale: "zh-Hans",
      title: "隐私政策",
      body: "仅处理提供服务所必需的数据。",
    })!;
    const complete = parseLegalDocumentWire({
      screen_id: "privacy_policy",
      document_version: "2026-08-12.1",
      effective_at: "2026-08-12T00:00:00Z",
      locale: "zh-Hans",
      title: "隐私政策",
      body: "完整隐私正文。".repeat(200),
    })!;

    expect(isLegalDynamicScreenComplete("privacy_policy", placeholder, "zh-Hans")).toBe(false);
    expect(isLegalDynamicScreenComplete("privacy_policy", complete, "zh-Hans")).toBe(true);
    expect(isLegalDynamicScreenComplete("daily_rewards", placeholder, "zh-Hans")).toBe(true);
  });

  it("recognizes canonical, versioned, and configured legal document IDs", () => {
    expect(legalDocumentKind("privacy_policy_v2")).toBe("privacy_policy");
    expect(legalDocumentKind("legal-wallet-terms-v3")).toBe("wallet_terms");
    expect(legalDocumentKind("privacy-center-2026", { privacyPolicy: "privacy-center-2026" })).toBe(
      "privacy_policy",
    );
    expect(legalDocumentKind("daily_rewards")).toBeNull();
  });

  it("requires legal metadata, exact response IDs, and the active locale", () => {
    const completeWallet = parseLegalDocumentWire({
      screen_id: "legal_wallet_terms_v2",
      document_version: "2026-08-13.1",
      effective_at: "2026-08-13T00:00:00Z",
      locale: "pt_BR",
      title: "BBchat",
      body: "Complete wallet terms. ".repeat(60),
    })!;

    expect(legalDocumentLocaleMatches("pt_BR", "pt-BR")).toBe(true);
    expect(
      isLegalDynamicScreenComplete(
        "legal_wallet_terms_v2",
        completeWallet,
        "pt-BR",
        "wallet_terms",
      ),
    ).toBe(true);
    expect(
      isLegalDynamicScreenComplete("wallet_terms_v2", completeWallet, "pt-BR", "wallet_terms"),
    ).toBe(false);
    expect(
      isLegalDynamicScreenComplete(
        "legal-wallet-terms-v2",
        completeWallet,
        "pt-BR",
        "wallet_terms",
      ),
    ).toBe(false);
    expect(
      isLegalDynamicScreenComplete("legal_wallet_terms_v2", completeWallet, "en", "wallet_terms"),
    ).toBe(false);
    expect(
      parseLegalDocumentWire({
        screen_id: "wallet_terms",
        title: "BBchat Recharge Agreement",
        body: "Body",
      }),
    ).toBeNull();
  });

  it("rejects the retired wallet brand in visible remote titles or bodies only", () => {
    const base = {
      screenId: "wallet_terms",
      documentVersion: "2026-08-13.1",
      effectiveAt: "2026-08-13T00:00:00Z",
      locale: "en",
      title: "BBchat Recharge Agreement",
      components: [
        {
          id: "body",
          type: "text",
          props: { text: "BBchat Gold Coins and Apple StoreKit terms. ".repeat(40) },
        },
      ],
    };

    expect(isLegalDynamicScreenComplete("wallet_terms", base, "en")).toBe(true);
    expect(
      isLegalDynamicScreenComplete(
        "wallet_terms",
        { ...base, title: "Cat-Box Recharge Agreement" },
        "en",
      ),
    ).toBe(false);
    expect(
      isLegalDynamicScreenComplete(
        "wallet_terms",
        {
          ...base,
          components: [
            {
              id: "body",
              type: "text",
              props: { text: "猫箱充值协议。".repeat(200) },
            },
          ],
        },
        "en",
      ),
    ).toBe(false);
    expect(
      isLegalDynamicScreenComplete(
        "wallet_terms",
        {
          ...base,
          components: [
            {
              id: "body",
              type: "text",
              props: { text: "Promotional Cat Food is not purchased Gold Coins. ".repeat(30) },
            },
          ],
        },
        "en",
      ),
    ).toBe(true);
  });
});
