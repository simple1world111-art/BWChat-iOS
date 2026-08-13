import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const originalRoot = "/Users/wegpt.com/Desktop/BWChat-Expo-HotUpdate/BWChat";
const expoRoot = resolve(__dirname, "../src");

describe("locked Swift to Expo chat-background source parity", () => {
  it("locks the untouched original view, store and API source", () => {
    expect(hash(original("Views/ChatBackgroundSettingsView.swift"))).toBe(
      "f463ac65695b4171567e90d1e43c0756d906bf6d5392934bc9cd8eac5062738d",
    );
    expect(hash(original("Services/ChatAppearanceStore.swift"))).toBe(
      "b4614b426e97f3559c8fc681c473c50175079a302af0ae20ff250f6d652ededf",
    );
    expect(hash(original("Services/APIService.swift"))).toBe(
      "8d0743a82ce63a40eddf8b435efead0769902ce2b12e1728bf6c247020b318d2",
    );
  });

  it("keeps the native visual constants and shared authenticated layer", () => {
    const layer = expo("components/chat/ChatBackgroundLayer.tsx");
    const settings = expo("app/chat-background-settings.tsx");
    expect(layer).toContain("saturation: 0.62");
    expect(layer).toContain("contrast: 0.82");
    expect(layer).toContain("brightness: 1.03");
    expect(layer).toContain("whiteOverlayOpacity: 0.46");
    expect(layer).toContain("AuthenticatedImage");
    expect(layer).toContain("sourceCacheKey={backgroundImageCacheKey(background)}");
    expect(layer).toContain('useColorScheme() === "dark" ? "#1C1C1E"');
    expect(settings).toContain("height: 280");
    expect(settings).toContain("paddingHorizontal: 16");
    expect(settings).toContain("paddingTop: 12");
    expect(settings).toContain("paddingBottom: 28");
  });

  it("keeps DirectChatSettings from the same Swift file and its strict clear route", () => {
    const direct = expo("app/direct-chat-settings.tsx");
    const api = expo("api/bwchat.ts");
    expect(direct).toContain("size={66}");
    expect(direct).toContain("paddingVertical: 22");
    expect(direct).toContain("rowGap: 18");
    expect(direct).toContain('pathname: "/chat-background-settings"');
    expect(direct).toContain("applyDirectHistoryClear");
    expect(direct).toContain("clearCachedDirectConversationPreview");
    expect(direct).toContain("error instanceof APIError");
    expect(api).toContain("`/chat/messages/${encodeURIComponent(contactId)}/history`");
    expect(api).toContain("requiredData: true");
    expect(api).toContain("requiredEnvelope: true");
  });

  it("uses the same layer in settings, direct chat and group chat", () => {
    for (const path of [
      "app/chat-background-settings.tsx",
      "app/chat/[id].tsx",
      "app/group-chat/[id].tsx",
    ]) {
      expect(expo(path)).toContain("ChatBackgroundLayer");
    }
    expect(expo("app/chat/[id].tsx")).not.toContain("chatBackgroundUrl");
    expect(expo("app/group-chat/[id].tsx")).not.toContain("backgroundUrl");
  });

  it("does not persist native in-memory background metadata to AsyncStorage", () => {
    const provider = expo("providers/ChatAppearanceProvider.tsx");
    const service = expo("services/chat-appearance/ChatAppearanceService.ts");
    expect(provider).not.toContain("AsyncStorage");
    expect(provider).not.toContain("saveCachedBackgrounds");
    expect(provider).not.toContain("readCachedBackgrounds");
    expect(service).not.toContain("bwchat.chat-backgrounds");
  });

  it("locks native routes, strict envelopes, upload limit and JPEG ladder", () => {
    const service = expo("services/chat-appearance/ChatAppearanceService.ts");
    expect(service).toContain('apiRequest<unknown>("/chat/backgrounds"');
    expect(service).toContain("requiredData: true");
    expect(service).toContain("requiredEnvelope: true");
    expect(service.match(/transientRetries: false/g)).toHaveLength(2);
    expect(service).toContain("requireNativeBackground");
    expect(service).not.toContain("value.targetType");
    expect(service).not.toContain("value.imageUrl");
    expect(service).not.toContain("flexibleString");
    expect(service).toContain("timeoutMs: 90_000");
    expect(service).toContain("[0.72, 0.65, 0.55, 0.45, 0.35]");
    expect(service).toContain("size <= 900_000");
    expect(service).toContain("dimension * 0.75");
    expect(service).toContain("Math.max(640");
  });

  it("guards teardown and keeps photo permission ownership with the system picker", () => {
    const provider = expo("providers/ChatAppearanceProvider.tsx");
    const settings = expo("app/chat-background-settings.tsx");
    expect(provider).toContain("mountedRef.current = false");
    expect(provider).toContain("revisionRef.current += 1");
    expect(settings).toContain("if (!mountedRef.current) return");
    expect(settings).toContain('t("api.decodingError")');
    expect(settings).toContain("launchImageLibraryAsync");
    expect(settings).not.toContain("requestMediaLibraryPermissionsAsync");
  });
});

function original(path: string): Buffer {
  return readFileSync(resolve(originalRoot, path));
}

function expo(path: string): string {
  return readFileSync(resolve(expoRoot, path), "utf8");
}

function hash(contents: Buffer): string {
  return createHash("sha256").update(contents).digest("hex");
}
