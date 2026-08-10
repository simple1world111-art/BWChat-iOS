import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  dynamicMainTabSlotCount,
  mainTabDescriptorTitle,
  mainTabSignature,
  resolveDynamicMainTabRoot,
  resolveMainTabEntries,
} from "@/services/main-tab/MainTabRegistry";
import type { DynamicTabDescriptor } from "@/services/remote-config/types";
import { defaultWebViewPolicy } from "@/services/web/WebViewPolicy";

const root = resolve(__dirname, "..");

describe("MainTab stable dynamic slot registry", () => {
  it("keeps the first known native root static and gives every unknown or duplicate root a stable slot", () => {
    const entries = resolveMainTabEntries([
      tab("remote-screen", { type: "screen", screenId: "help" }),
      tab("messages", { type: "native", name: "messages" }),
      tab("messages-alias", { type: "native", name: "messages" }),
      tab("map", { type: "native", name: "map" }),
      tab("nearby-copy", { type: "native", name: "nearby" }),
    ]);

    expect(entries.map(({ routeName, slotIndex }) => ({ routeName, slotIndex }))).toEqual([
      { routeName: "dynamic-tab-00", slotIndex: 0 },
      { routeName: "conversations", slotIndex: undefined },
      { routeName: "dynamic-tab-01", slotIndex: 1 },
      { routeName: "map", slotIndex: undefined },
      { routeName: "dynamic-tab-02", slotIndex: 2 },
    ]);
  });

  it("covers the full 20-descriptor remote schema even when all accepted descriptors need slots", () => {
    const remote = Array.from({ length: 20 }, (_, index) =>
      tab(`remote-${index}`, { type: "screen", screenId: `screen-${index}` }),
    );
    const requiredCore = [
      tab("messages", { type: "native", name: "messages" }),
      tab("discover", { type: "native", name: "discover" }),
      tab("test", { type: "native", name: "test" }),
      tab("profile", { type: "native", name: "profile" }),
    ];
    const entries = resolveMainTabEntries([...remote, ...requiredCore]);
    expect(dynamicMainTabSlotCount).toBe(20);
    expect(entries).toHaveLength(24);
    expect(entries.filter((entry) => entry.slotIndex !== undefined)).toHaveLength(20);
    expect(new Set(entries.map((entry) => entry.routeName)).size).toBe(24);
  });

  it("dispatches known native, screen, allowlisted web and placeholder roots in Swift order", () => {
    expect(
      resolveDynamicMainTabRoot(
        tab("messages-copy", { type: "external", name: "messages", url: "custom://ignored" }),
        defaultWebViewPolicy,
      ),
    ).toEqual({ kind: "native", name: "messages" });
    expect(
      resolveDynamicMainTabRoot(
        tab("test", { type: "native", name: "test" }),
        defaultWebViewPolicy,
      ),
    ).toEqual({ kind: "native", name: "test" });
    expect(
      resolveDynamicMainTabRoot(
        tab("help", { type: "screen", screenId: "help_center" }),
        defaultWebViewPolicy,
      ),
    ).toEqual({ kind: "screen", screenId: "help_center" });
    expect(
      resolveDynamicMainTabRoot(
        tab("web", { type: "h5", url: "https://id7.com/help" }),
        defaultWebViewPolicy,
      ),
    ).toEqual({ kind: "web", url: "https://id7.com/help" });
    expect(
      resolveDynamicMainTabRoot(
        tab("blocked-web", { type: "web", url: "https://blocked.example/help" }),
        defaultWebViewPolicy,
      ),
    ).toEqual({ kind: "placeholder" });
    expect(
      resolveDynamicMainTabRoot(
        tab("external", { type: "external", url: "custom://open" }),
        defaultWebViewPolicy,
      ),
    ).toEqual({ kind: "placeholder" });
  });

  it("falls back from a blank route name to the descriptor id like UIKitNav", () => {
    expect(
      resolveDynamicMainTabRoot(
        { id: "messages", route: { type: "native", name: "   " } },
        defaultWebViewPolicy,
      ),
    ).toEqual({ kind: "native", name: "messages" });
  });

  it("treats a present route without type as coming-soon even if the descriptor type says screen", () => {
    expect(
      resolveDynamicMainTabRoot(
        { id: "strict", type: "screen", route: { screenId: "must-not-open" } },
        defaultWebViewPolicy,
      ),
    ).toEqual({ kind: "placeholder" });
  });

  it("uses the native dynamic title fallback order", () => {
    const translate = (key: string) => (key === "tab.remote" ? "Translated" : key);
    expect(
      mainTabDescriptorTitle(
        { id: "fallback", titleKey: "tab.remote", title: "Raw" },
        "Fallback",
        "en",
        translate,
      ),
    ).toBe("Translated");
    expect(
      mainTabDescriptorTitle(
        { id: "fallback", titleI18n: { ja: "日本語", en: "English" } },
        "Fallback",
        "ja",
        translate,
      ),
    ).toBe("日本語");
  });

  it("resets retained roots when the native tab-controller signature changes", () => {
    const translate = (key: string) => key;
    const originalEntries = resolveMainTabEntries([
      {
        id: "help",
        title: "Help",
        systemImage: "questionmark.circle",
        selectedSystemImage: "questionmark.circle.fill",
        route: { type: "screen", screenId: "help" },
      },
    ]);
    const original = mainTabSignature(originalEntries, "en", translate);
    expect(mainTabSignature(originalEntries, "en", translate)).toBe(original);
    expect(
      mainTabSignature(
        resolveMainTabEntries([{ ...originalEntries[0]!.descriptor, title: "Support" }]),
        "en",
        translate,
      ),
    ).not.toBe(original);
  });

  it("ships every slot route and wires the dispatcher to embedded screen/web roots", () => {
    const tabFiles = readdirSync(resolve(root, "src/app/(tabs)"))
      .filter((name) => /^dynamic-tab-\d{2}\.tsx$/u.test(name))
      .sort();
    expect(tabFiles).toHaveLength(dynamicMainTabSlotCount);
    expect(tabFiles[0]).toBe("dynamic-tab-00.tsx");
    expect(tabFiles.at(-1)).toBe("dynamic-tab-19.tsx");
    const rootSource = readFileSync(
      resolve(root, "src/components/main-tab/DynamicMainTabRoot.tsx"),
      "utf8",
    );
    expect(rootSource).toContain("<DynamicScreenContent");
    expect(rootSource).toContain("<InAppWebContent");
    expect(rootSource).toContain("<DynamicTabPlaceholder");
    expect(readFileSync(resolve(root, "src/app/in-app-web.tsx"), "utf8")).toContain("isTabRoot");
    expect(readFileSync(resolve(root, "src/app/dynamic-screen/[id].tsx"), "utf8")).toContain(
      "isTabRoot",
    );
  });
});

function tab(id: string, route: DynamicTabDescriptor["route"]): DynamicTabDescriptor {
  return { id, route };
}
