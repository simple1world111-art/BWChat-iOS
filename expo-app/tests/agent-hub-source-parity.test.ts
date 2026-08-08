import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const expoRoot = resolve(__dirname, "..");
const nativeRoot = resolve(expoRoot, "..");
const originalNativeRoot = resolve(expoRoot, "../../BWChat-iOS");

describe("AgentHubView source parity", () => {
  it("locks every native source against both the original and desktop Swift trees", () => {
    const hashes: Record<string, string> = {
      "BWChat/Views/AgentHubView.swift":
        "6f57bf50805946f4d9755b97a11a20713d000e1b09b872fd1b0a0df6b7191e09",
      "BWChat/ViewModels/AgentCatalogViewModel.swift":
        "13e5897fe2194d81ff49cc0172290ef3aacf54285657df1d4d4d14e0e47e870c",
      "BWChat/Services/APIService.swift":
        "e0a29cc6030ad4329980affc5da3f29a34c3000a65637f855e19c7e38666a274",
      "BWChat/Models/AgentModels.swift":
        "18b9a3dcdcb0477d5f93fb742e51cf5e277fd4a63c71c7d9c3a755adfd477ae7",
      "BWChat/Services/CacheRepository.swift":
        "530f9734eeb9fdc8aeafc3e5430d5eae876754462372bb3c05c9b830526f0b66",
      "BWChat/Models/Conversation.swift":
        "030f004ed7a1c4ee0a2c927eb91ba2274c9350d7e9b69e91fc3cccb76567c821",
      "BWChat/Models/Gift.swift":
        "62961899ae81d7d7f16438fbd61a42ca44f6b2eb21227bd21b7b51f5f6b28fd1",
      "BWChat/Utils/Extensions.swift":
        "e625dab1ea95cbd63d74c1e8bf33d4bf3f4a85adbd2001c1b0ca27a99bcc5ce5",
      "BWChat/Views/ScriptCenterView.swift":
        "e8095af14ad25b459f6b2628c728b827f2665939af3c92bc699df13f0d83eda2",
      "BWChat/Services/DynamicRouteHandler.swift":
        "fba6f7c42e069901cd310940dad900f7c48a24b92b94fe6083efb7fa2abe24b2",
    };
    for (const [relativePath, expectedHash] of Object.entries(hashes)) {
      const copied = sourceNative(relativePath);
      expect(copied).toBe(sourceOriginalNative(relativePath));
      expect(createHash("sha256").update(copied).digest("hex")).toBe(expectedHash);
    }
  });

  it("keeps the dynamic Agent Hub entry and stack route without an airplane dependency", () => {
    const native = sourceNative("BWChat/Services/DynamicRouteHandler.swift");
    const navigator = sourceExpo("src/services/web/DynamicRouteNavigator.ts");
    const layout = sourceExpo("src/app/_layout.tsx");
    expect(native).toContain('case "agent_hub":');
    expect(native).toContain("navigator.push(AgentHubView())");
    expect(navigator).toContain('agent_hub: "/agent-hub"');
    expect(layout).toContain('<Stack.Screen name="agent-hub" options={{ title: "智能体" }} />');
    expect(`${navigator}\n${layout}`).not.toMatch(/airplane|flight/iu);
  });

  it("keeps native sections and conditional visibility in source order", () => {
    const native = sourceNative("BWChat/Views/AgentHubView.swift");
    const expo = sourceExpo("src/app/agent-hub.tsx");
    expectOrdered(native, [
      'sectionTitle("最近会话")',
      'sectionTitle("我加入的剧本")',
      'sectionTitle("我的智能体")',
    ]);
    expectOrdered(expo, ["最近会话", "我加入的剧本", "我的智能体"]);
    expect(expo).toContain("snapshot.conversations.length > 0");
    expect(expo).toContain("snapshot.joinedScriptRooms.length > 0");
    expect(expo).toContain("snapshot.installedAgents.length === 0");
  });

  it("keeps cache-first loading, five-way partial refresh and five-minute foreground refresh", () => {
    const page = sourceExpo("src/app/agent-hub.tsx");
    expectOrdered(page, ["loadCachedAgentCatalog(ownerId)", "Promise.allSettled(["]);
    for (const operation of [
      "getAgentRuntimeConfig()",
      "getInstalledAgents()",
      "getAgentConversations()",
      "getConversationSyncSnapshot()",
      "getWalletBalance()",
    ]) {
      expect(page).toContain(operation);
    }
    expect(page).toContain("if (!cached.isStale && !forceRefresh) return");
    expect(page).toContain("agentHubMetrics.runtimeRefreshMilliseconds");
    expect(page).toContain("results.find(");
    expect(page).toContain('result.status === "rejected"');
  });

  it("keeps native open, edit, uninstall, script and creator actions", () => {
    const page = sourceExpo("src/app/agent-hub.tsx");
    expect(page).toContain(
      "latestOpenAgentConversation(snapshotRef.current.conversations, agent.id)",
    );
    expect(page).toContain("idempotencyKeys.current.get(agent.id) ?? randomUUID()");
    expect(page).toContain("idempotencyKeys.current.delete(agent.id)");
    expect(page).toContain("await uninstallAgent(agent.id)");
    expect(page).toContain('title: "调整智能体"');
    expect(page).toContain('title: "从我的智能体中移除"');
    expect(page).toContain("<MenuView");
    expect(page).toContain("shouldOpenOnLongPress");
    expect(page).toContain('image: "slider.horizontal.3"');
    expect(page).toContain('image: "trash"');
    expect(page).toContain("attributes: { destructive: true }");
    expect(page).toContain('pathname: "/agent-creator"');
    expect(page).toContain('pathname: "/agent-chat"');
    expect(page).toContain('pathname: "/script-room-chat"');
    expect(page).toContain(
      'if (!trimFoundationWhitespacesAndNewlines(conversation.script_room_id ?? "")) return',
    );
    expect(page).toContain("subscribeAgentUpdates((agent) =>");
    expect(page).toContain("installedAgents: upsertInstalledAgent(");
    expect(page).toContain("await load(true)");
  });

  it("remounts the entire account-owned hub without a stale first frame", () => {
    const page = sourceExpo("src/app/agent-hub.tsx");
    expect(page).toContain(
      '<AgentHubAccountScreen key={ownerId || "signed-out"} ownerId={ownerId} t={t} />',
    );
    expect(page).toContain("const activeOwnerRef = useRef(ownerId)");
    expect(page).toContain("activeOwnerRef.current !== requestedOwner");
  });

  it("keeps native avatar states and the full accessibility surface", () => {
    const page = sourceExpo("src/app/agent-hub.tsx");
    expect(page).toContain('colors={[theme.accentSoft, "#F2E8FF"]}');
    expect(page).toContain("loadingFallback={loadingFallback}");
    expect(page).toContain("errorFallback={errorFallback}");
    expect(page).toContain('name="book.closed.fill"');
    expect(page).toContain("size={24}");
    expect(page).toContain('accessibilityRole="progressbar"');
    expect(page).toContain('accessibilityRole="alert"');
    expect(page).toContain('accessibilityLiveRegion="assertive"');
    expect(page).toContain("accessibilityState={{ busy: working, disabled }}");
    expect(page).toContain('accessibilityRole="header"');
  });

  it("keeps native legacy cache decoding and cross-entry conversation invalidation", () => {
    const cache = sourceExpo("src/services/agents/AgentCatalogRepository.ts");
    const resolver = sourceExpo("src/services/agents/AgentConversationResolver.ts");
    expect(cache).toContain("walletBalance?: unknown");
    expect(cache).toContain("Array.isArray(legacy.joinedScriptRooms)");
    expect(cache).toContain("Array.isArray(legacy.installedAgents)");
    expect(cache).toContain("Array.isArray(legacy.conversations)");
    expect(resolver).toContain("const accountMemory = new Map<string, AccountResolverMemory>()");
    expect(resolver).toContain("resetAgentConversationMemoryForAccount(ownerId: string)");
    expect(resolver).toContain("memory.generation === generation");
    expect(resolver).toContain("await invalidateAgentCatalog(ownerScope).catch");
  });

  it("locks Foundation blank handling, Creator write-through and native capability error ordering", () => {
    const page = sourceExpo("src/app/agent-hub.tsx");
    const policy = sourceExpo("src/services/agents/agentHubPolicy.ts");
    const cache = sourceExpo("src/services/agents/AgentCatalogRepository.ts");
    expect(page).toContain("trimFoundationWhitespacesAndNewlines(");
    expect(policy).toContain("trimFoundationWhitespacesAndNewlines(");
    expect(cache).toContain("trimFoundationWhitespacesAndNewlines(ownerId)");
    const listener = page.slice(
      page.indexOf("subscribeAgentUpdates((agent) =>"),
      page.indexOf("useEffect(() => {", page.indexOf("subscribeAgentUpdates((agent) =>")),
    );
    expectOrdered(listener, ["applySnapshot(next)", "await persist(next)", "await load(true)"]);
    expect(page).toContain("setErrorMessage(readableError(refreshError))");
  });

  it("uses only dynamic authenticated avatars and native symbols", () => {
    const native = sourceNative("BWChat/Views/AgentHubView.swift");
    const page = sourceExpo("src/app/agent-hub.tsx");
    expect(native).toContain('Image(systemName: "sparkles")');
    expect(native).toContain('fallbackSystemImage: "book.closed.fill"');
    expect(page).toContain("`/agent-assets/${encodeURIComponent(assetId)}`");
    expect(page).toContain('name="book.closed.fill"');
    expect(page).not.toMatch(/require\([^)]*\.(png|jpe?g|webp)/u);
  });
});

function expectOrdered(source: string, values: string[]): void {
  let cursor = -1;
  for (const value of values) {
    const index = source.indexOf(value, cursor + 1);
    expect(index).toBeGreaterThan(cursor);
    cursor = index;
  }
}

function sourceExpo(relativePath: string): string {
  return readFileSync(resolve(expoRoot, relativePath), "utf8");
}

function sourceNative(relativePath: string): string {
  return readFileSync(resolve(nativeRoot, relativePath), "utf8");
}

function sourceOriginalNative(relativePath: string): string {
  return readFileSync(resolve(originalNativeRoot, relativePath), "utf8");
}
