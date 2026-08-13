import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const expoRoot = resolve(__dirname, "..");
const nativeRoot = resolve(expoRoot, "..");
const originalRoot = nativeRoot;

describe("ScriptRoomChatView source parity", () => {
  it("locks every copied native source used by room UI, state, API and cache", () => {
    const hashes: Record<string, string> = {
      "BWChat/Views/ScriptRoomChatView.swift":
        "afeb6cc371e98d0b54783e451b298f0c07d9111b37670c96135c4ceae5803a39",
      "BWChat/Views/ScriptCenterView.swift":
        "e8095af14ad25b459f6b2628c728b827f2665939af3c92bc699df13f0d83eda2",
      "BWChat/ViewModels/InteractiveScriptViewModels.swift":
        "53618004998796bffb0afa3d32e47eeb881bb837e1b9032bf9cdbff7a86cf1c9",
      "BWChat/Models/InteractiveScript.swift":
        "f272d793b0e060fdea99be654e0961abcb22a867264447bf9461dfa6d27ae8ed",
      "BWChat/Models/Group.swift":
        "9cc71d2d874002629302dd14f06183bd80cb396f7bfcdd3fbf5838b549bee792",
      "BWChat/Services/APIService.swift":
        "8d0743a82ce63a40eddf8b435efead0769902ce2b12e1728bf6c247020b318d2",
      "BWChat/Services/WebSocketService.swift":
        "1d9db3787bbcf1c10de58e9861d2c925516c2d8d184c7905ef3320894ddcc262",
      "BWChat/Services/CacheRepository.swift":
        "570ed9486b10b8b55ddd6136c04c11a1390a287a14563492c640a6a2f144e117",
      "BWChat/Services/MessageStore.swift":
        "51d68cb2481dab3ebf2fcaabc0ce1a79d8eac3e8df1720531e2a92f4972402a7",
      "BWChat/Views/WalletView.swift":
        "babacba715143e9dc90ca4db768a0fd9c40e7db17c922edfae4a5273f373b0cd",
    };
    for (const [relativePath, expected] of Object.entries(hashes)) {
      const copied = sourceNative(relativePath);
      const original = sourceOriginal(relativePath);
      expect(copied).toBe(original);
      expect(createHash("sha256").update(copied).digest("hex")).toBe(expected);
    }
  });

  it("preserves roster, reversed timeline, story, state and composer geometry", () => {
    const native = sourceNative("BWChat/Views/ScriptRoomChatView.swift");
    const policy = sourceExpo("src/services/scripts/scriptRoomPolicy.ts");
    const screen = sourceExpo("src/app/script-room-chat.tsx");
    for (const contract of [
      "HStack(spacing: 10)",
      ".frame(width: 40, height: 40)",
      ".frame(width: 12, height: 12)",
      ".frame(width: 52)",
      "LazyVStack(spacing: 13)",
      ".frame(width: 96, height: 72)",
      ".clipShape(RoundedRectangle(cornerRadius: 14))",
      ".lineLimit(1...5)",
      "String($0.prefix(1000))",
      ".frame(width: 38, height: 38)",
      "Spacer(minLength: 52)",
      ".frame(width: 32, height: 32)",
    ]) {
      expect(native).toContain(contract);
    }
    for (const contract of [
      "rosterGap: 10",
      "rosterAvatarSize: 40",
      "rosterBadgeSize: 12",
      "rosterRoleWidth: 52",
      "timelineGap: 13",
      "storyCoverWidth: 96",
      "storyCoverHeight: 72",
      "storyRadius: 14",
      "inputMaximumCharacters: 1000",
      "sendSize: 38",
      "messageSideSpacer: 52",
      "messageAvatarSize: 32",
    ]) {
      expect(policy).toContain(contract);
    }
    expect(screen).toContain("inverted");
    expect(screen).toContain("data={orderedMessages}");
    expect(screen).toContain("ListFooterComponent={<StoryHeader");
    expect(screen).toContain("ListHeaderComponent=");
  });

  it("preserves native menu, confirmation, status transitions and scroll timing", () => {
    const native = sourceNative("BWChat/Views/ScriptRoomChatView.swift");
    const screen = sourceExpo("src/app/script-room-chat.tsx");
    const policy = sourceExpo("src/services/scripts/scriptRoomPolicy.ts");
    expect(native).toContain("Menu {");
    expect(native).toContain("Button(role: .destructive)");
    expect(native).toContain(".confirmationDialog(");
    expect(native).toContain("duration: 3");
    expect(native).toContain("deadline: .now() + 0.05");
    expect(native).toContain(".easeOut(duration: 0.2)");
    expect(screen).toContain("<MenuView");
    expect(screen).toContain('image: "stop.circle"');
    expect(screen).toContain("attributes: { destructive: true }");
    expect(screen).toContain("Alert.alert(");
    expect(screen).toContain("size={36}");
    expect(screen).not.toContain("retryLoadButton");
    expect(policy).toContain("toastMilliseconds: 3_000");
    expect(policy).toContain("scrollDelayMilliseconds: 50");
    expect(policy).toContain("scrollAnimationMilliseconds: 200");
  });

  it("keeps full live history, a 100-message persistent seed and account-safe late work", () => {
    const nativeViewModel = sourceNative("BWChat/ViewModels/InteractiveScriptViewModels.swift");
    const screen = sourceExpo("src/app/script-room-chat.tsx");
    const policy = sourceExpo("src/services/scripts/scriptRoomPolicy.ts");
    const repository = sourceExpo("src/services/scripts/ScriptRoomRepository.ts");
    const navigation = sourceExpo("src/services/scripts/ScriptRoomNavigationStore.ts");
    expect(nativeViewModel).toContain("loadGroupMessagesAsync(groupID: groupID, limit: 100)");
    expect(nativeViewModel).toContain("messages = keyed.values.sorted");
    expect(nativeViewModel).not.toContain("messages = Array(keyed.values.suffix(100))");
    expect(policy).toContain("export function mergeScriptMessages(");
    expect(policy).toContain(
      ".filter((message) => groupId === undefined || message.group_id === groupId)",
    );
    expect(repository).toContain("mergeCachedScriptMessages");
    expect(repository).toContain("encodeURIComponent(ownerId)");
    expect(navigation).toContain("pendingConversation?.ownerId === ownerId.trim()");
    expect(screen).toContain("pendingScriptRoomConversation(roomId, ownerId)");
    expect(screen).toContain("scriptRoomSessionKey(requestedOwner, requestedRoomId)");
    expect(screen).toContain("sessionGenerationRef.current += 1");
    expect(screen).toContain("activeGeneration.current === requestedGeneration");
    expect(screen).toContain("loadingOperationRef.current?.promise === operation");
    expect(screen).toContain("generating || sendingRef.current");
    expect(screen).toContain("isSending || sendingRef.current");
    expect(screen).toContain("randomUUID().toUpperCase()");
    expect(screen).toContain('setInputText("")');
    expect(screen).toContain("setSending(false)");
  });

  it("matches exact room routes, strict envelopes, read sync and local preview publication", () => {
    const nativeApi = sourceNative("BWChat/Services/APIService.swift");
    const nativeViewModel = sourceNative("BWChat/ViewModels/InteractiveScriptViewModels.swift");
    const api = sourceExpo("src/api/bwchat.ts");
    const screen = sourceExpo("src/app/script-room-chat.tsx");
    const realtime = sourceExpo("src/services/realtime/ChatRealtimeService.ts");
    for (const route of [
      '"/script-rooms/\\(Self.pathComponent(roomID))"',
      '"/script-rooms/\\(Self.pathComponent(roomID))/turns"',
      '"/script-rooms/\\(Self.pathComponent(roomID))/turns/\\(Self.pathComponent(turnID))/retry"',
      '"/script-rooms/\\(Self.pathComponent(roomID))/end"',
      '"/groups/\\(groupID)/messages"',
      '"/groups/\\(groupID)/messages/read"',
    ]) {
      expect(nativeApi).toContain(route);
    }
    expect(api).toContain("requiredData: true");
    expect(api).toContain("requiredEnvelope: true");
    expect(api).toContain("normalizeScriptRoomEnvelope(");
    expect(api).toContain('headers: { "Idempotency-Key": idempotencyKey }');
    expect(api).toContain("globalThis.crypto.randomUUID().toUpperCase()");
    expect(nativeViewModel).toContain(".conversationPreviewDidChange");
    expect(screen).toContain("publishLocalGroupMessage(requestedOwner, response.user_message)");
    expect(screen).toContain("locallyPublishedMessageIdsRef.current.delete(event.message.id)");
    expect(realtime).toContain("owner !== this.ownerId");
    expect(realtime).toContain('type: "group_message", message');
    expect(realtime).toContain("if (!isRecord(envelope.data)) return []");
  });

  it("does not invent a vote lifecycle or backend contract absent from the native room", () => {
    const sources = [
      sourceNative("BWChat/Views/ScriptRoomChatView.swift"),
      sourceNative("BWChat/ViewModels/InteractiveScriptViewModels.swift"),
      sourceNative("BWChat/Models/InteractiveScript.swift"),
      sourceNative("BWChat/Services/APIService.swift"),
      sourceExpo("src/app/script-room-chat.tsx"),
      sourceExpo("src/services/scripts/scriptRoomPolicy.ts"),
      sourceExpo("src/api/bwchat.ts"),
    ].join("\n");
    expect(sources).not.toMatch(/\b(vote|voting|ballot|poll)\b/iu);
  });

  it("reuses dynamic authenticated media and invents no bitmap assets", () => {
    const native = sourceNative("BWChat/Views/ScriptRoomChatView.swift");
    const nativeRemoteImage = sourceNative("BWChat/Views/ScriptCenterView.swift");
    const screen = sourceExpo("src/app/script-room-chat.tsx");
    expect(native).toContain("ScriptRemoteImage(");
    expect(native).toContain("AvatarView(url: message.senderAvatar, size: 32)");
    expect(nativeRemoteImage).toContain('Color(hex: "F2E8FF")');
    expect(nativeRemoteImage).toContain(".font(.system(size: 24, weight: .semibold))");
    expect(screen).toContain("<AuthenticatedImage");
    expect(screen).toContain("<Avatar name={message.sender_nickname} size={32}");
    expect(screen).toContain("styles.scriptFallbackEnd.color");
    expect(screen).toContain("size={24}");
    expect(screen).toContain('backgroundColor: "rgba(102,126,234,0.12)"');
    expect(screen).toContain("resolveMediaUrl(url, env.apiBaseUrl)");
    expect(screen).not.toMatch(/require\([^)]*\.(png|jpe?g|webp)/u);
  });
});

function sourceExpo(relativePath: string): string {
  return readFileSync(resolve(expoRoot, relativePath), "utf8");
}

function sourceNative(relativePath: string): string {
  return readFileSync(resolve(nativeRoot, relativePath), "utf8");
}

function sourceOriginal(relativePath: string): string {
  return readFileSync(resolve(originalRoot, relativePath), "utf8");
}
