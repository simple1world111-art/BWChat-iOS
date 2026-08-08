import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const expoRoot = resolve(__dirname, "..");
const nativeRoot = resolve(expoRoot, "..");

describe("AgentCreatorView source parity", () => {
  it("keeps all 19 native Form sections in the exact source order", () => {
    const native = sourceNative("BWChat/Views/AgentCreatorView.swift");
    const expo = sourceExpo("src/app/agent-creator.tsx");
    const sections = [
      "视觉形象",
      "智能体名称",
      "一句话介绍",
      "详细描述",
      "标签",
      "语言",
      "可见性",
      "身份设定",
      "性格",
      "对话语气",
      "回复长度",
      "开场白",
      "关系类型",
      "称呼方式",
      "成人互动",
      "亲密风格",
      "主动程度",
      "图片能力",
      "视频能力",
    ];
    expectOrdered(
      native,
      sections.map((title) => `sectionHeader("${title}")`),
    );
    expectOrdered(
      expo,
      sections.map((title) => `title="${title}"`),
    );
  });

  it("preserves every native picker value and the disabled video capability", () => {
    const page = sourceExpo("src/app/agent-creator.tsx");
    for (const value of [
      "zh-CN",
      "en",
      "ja",
      "private",
      "unlisted",
      "public",
      "warm",
      "natural",
      "playful",
      "direct",
      "short",
      "medium",
      "long",
      "companion",
      "girlfriend",
      "wife",
      "dating_partner",
      "romantic_partner",
      "boyfriend",
      "husband",
      "romantic",
      "sensual",
      "responsive",
      "balanced",
      "proactive",
    ]) {
      expect(page).toContain(`value: "${value}"`);
    }
    expect(page).toContain('<Toggle isOn={false} label="付费视频" modifiers={[disabled()]} />');
    expect(page).toContain("视频 Provider 当前未启用，客户端不会开放视频生成。");
  });

  it("fails closed for an unresolved edit deep link and locks same-frame submissions", () => {
    const page = sourceExpo("src/app/agent-creator.tsx");
    expect(page).toContain("const hasResolvedMode = !agentId || isEditing");
    expect(page).toContain(
      "if (!canSave || saveLockRef.current || (agentId && !currentAgent)) return",
    );
    expect(page).toContain("saveLockRef.current = true");
    expect(page).toContain("saveLockRef.current = false");
    expect(page).toContain("referencePickerLockRef.current");
  });

  it("exposes save, image, input, error and hydration accessibility semantics", () => {
    const page = sourceExpo("src/app/agent-creator.tsx");
    expect(page).toContain("accessibilityState={{ busy: isSaving, disabled: !canSave }}");
    expect(page).toContain('accessibilityRole="button"');
    expect(page).toContain("busy: isLoadingReference");
    expect(page).toContain("accessibilityLabel={title}");
    expect(page).toContain('accessibilityRole="alert"');
    expect(page).toContain('accessibilityRole="progressbar"');
    expect(page).toContain('importantForAccessibility="no-hide-descendants"');
  });

  it("keeps native save lifecycle, conflict recovery, cache invalidation and back navigation", () => {
    const page = sourceExpo("src/app/agent-creator.tsx");
    const transaction = sourceExpo("src/services/agents/AgentCreatorTransaction.ts");
    expectOrdered(transaction, [
      "dependencies.prepareReference(",
      "dependencies.uploadReference(",
      "dependencies.create(",
      "dependencies.publish(",
      "dependencies.install(",
      "dependencies.createConversation(",
    ]);
    expect(page).toContain("agentCreatorErrorCode(error) === 6002");
    expect(page).toContain("const latest = await getAgent(currentAgent.id)");
    expect(page).toContain("草稿已在其他位置更新，已重新加载最新版本，请确认后再保存。");
    expect(page).toContain("invalidateAgentCatalog(requestedOwner)");
    expect(page).toContain("notifyAgentUpdated(installed)");
    expect(page).toContain("router.back()");
  });

  it("isolates direct-link hydration and save results by owner and route generation", () => {
    const page = sourceExpo("src/app/agent-creator.tsx");
    const transaction = sourceExpo("src/services/agents/AgentCreatorTransaction.ts");
    expect(page).toContain("pendingAgentForEditing(agentId, ownerId)");
    expect(page).toContain("routeGenerationRef.current === generation");
    expect(page).toContain("activeOwnerRef.current === requestedOwner");
    expect(page).toContain("if (!ownerId || !agentId)");
    expect(page).toContain("if (agent.id !== agentId)");
    expect(page).toContain("checkpoint: transactionCheckpointRef.current");
    expect(page).toContain("key={JSON.stringify([ownerId, agentId])}");
    expect(transaction).toContain("checkpoint.ownerId !== ownerId");
    expect(transaction).toContain("checkpoint.sourceAgentId !== sourceAgentId");
    expect(transaction).toContain("checkpoint.sourceRevision !== sourceRevision");
  });

  it("cleans generated JPEG cache files without deleting picker or backend assets", () => {
    const page = sourceExpo("src/app/agent-creator.tsx");
    const policy = sourceExpo("src/services/agents/agentCreatorPolicy.ts");
    const transaction = sourceExpo("src/services/agents/AgentCreatorTransaction.ts");
    expect(page).toContain("removeAgentCreatorTemporaryFile(temporaryReferenceUri)");
    expect(page).toContain("removeAgentCreatorTemporaryFile(uri)");
    expect(policy).toContain("if (file.exists) file.delete()");
    expect(transaction).toContain("preparedUri !== input.selectedReference.uri");
    expect(transaction).toContain("dependencies.disposePreparedReference?.(preparedUri)");
  });

  it("retains keys for an unchanged retry and rotates only newly changed upload/publish work", () => {
    const page = sourceExpo("src/app/agent-creator.tsx");
    const fieldChange = page.slice(
      page.indexOf("const setField"),
      page.indexOf("const pickReference"),
    );
    const referenceChange = page.slice(
      page.indexOf("const pickReference"),
      page.indexOf("const save ="),
    );
    expect(page).toContain("idempotencyKeys: idempotencyKeysRef.current");
    expect(fieldChange).toContain("transactionCheckpointRef.current?.draft");
    expect(fieldChange).toContain("publish: randomUUID()");
    expect(fieldChange).not.toContain("create: randomUUID()");
    expect(referenceChange).toContain("upload: randomUUID()");
    expect(referenceChange).toContain("publish: randomUUID()");
    expect(referenceChange).not.toContain("create: randomUUID()");
  });

  it("does not invent creator deletion; native removal remains Agent Hub uninstall", () => {
    const creator = sourceExpo("src/app/agent-creator.tsx");
    const hub = sourceExpo("src/app/agent-hub.tsx");
    const api = sourceExpo("src/api/bwchat.ts");
    expect(creator).not.toContain("uninstallAgent(");
    expect(creator).not.toContain("删除智能体");
    expect(hub).toContain("await uninstallAgent(agent.id)");
    expect(api).toContain('method: "DELETE"');
    expect(api).toContain("`/agents/${encodeURIComponent(agentId)}/install`");
  });

  it("keeps the exact native reference multipart field, filename and JPEG MIME", () => {
    const api = sourceExpo("src/api/bwchat.ts");
    expect(api).toContain('form.append("image"');
    expect(api).toContain('name: "agent-reference.jpg"');
    expect(api).toContain('type: "image/jpeg"');
    expect(api).toContain('headers: { "Idempotency-Key": idempotencyKey }');
    expect(api).toContain("timeoutMs: 90_000");
    expect(api).toContain("transientRetries: false");
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
