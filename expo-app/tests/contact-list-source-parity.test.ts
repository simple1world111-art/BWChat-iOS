import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const expoRoot = resolve(__dirname, "..");
const nativeRoot = resolve(expoRoot, "..");

describe("ContactList source parity", () => {
  it("locks the native view, view-model, model, API, cache and timestamp sources", () => {
    const hashes: Record<string, string> = {
      "BWChat/Views/ContactListView.swift":
        "f786ada66fdf954c2f6a9ddd2d2383a7e87b06939dc46cccdd38abeec904ac6f",
      "BWChat/ViewModels/ConversationListViewModel.swift":
        "28056a107b7e50e8d9555cf7c4a0d651ded402dda10344222a7b6c1a39d87b4b",
      "BWChat/Models/Conversation.swift":
        "030f004ed7a1c4ee0a2c927eb91ba2274c9350d7e9b69e91fc3cccb76567c821",
      "BWChat/Models/Contact.swift":
        "cdd7c6109d62ddca311439a5e4c975b5d9e343608e1d4c7cf0b20be473f59bc2",
      "BWChat/Models/Group.swift":
        "9cc71d2d874002629302dd14f06183bd80cb396f7bfcdd3fbf5838b549bee792",
      "BWChat/Services/APIService.swift":
        "e0a29cc6030ad4329980affc5da3f29a34c3000a65637f855e19c7e38666a274",
      "BWChat/Services/CacheRepository.swift":
        "530f9734eeb9fdc8aeafc3e5430d5eae876754462372bb3c05c9b830526f0b66",
      "BWChat/Services/MessageStore.swift":
        "51d68cb2481dab3ebf2fcaabc0ce1a79d8eac3e8df1720531e2a92f4972402a7",
      "BWChat/Services/PushService.swift":
        "e84e820a5ec176a9ab1b4f08601037bd50d1a7a78ea37b3d5bfbfa6437b9d161",
      "BWChat/Utils/UIKitNav.swift":
        "54d1f479588bae9bd382f014a79c6c959df1aead402b8863e390fd854b527b5f",
      "BWChat/Utils/Extensions.swift":
        "e625dab1ea95cbd63d74c1e8bf33d4bf3f4a85adbd2001c1b0ca27a99bcc5ce5",
    };
    for (const [relativePath, expected] of Object.entries(hashes)) {
      expect(createHash("sha256").update(sourceNative(relativePath)).digest("hex")).toBe(expected);
    }
  });

  it("preserves load, cache, merge, visibility and realtime behavior", () => {
    const native = sourceNative("BWChat/ViewModels/ConversationListViewModel.swift");
    const page = sourceExpo("src/app/(tabs)/conversations.tsx");
    const policy = sourceExpo("src/services/conversations/ConversationListPolicy.ts");
    const repository = sourceExpo("src/services/conversations/ConversationRepository.ts");
    const accountScope = sourceExpo("src/services/conversations/ConversationAccountScope.ts");
    const unreadStore = sourceExpo("src/services/conversations/ConversationUnreadStore.ts");
    for (const contract of [
      "snapshotComplete",
      "preservingLiveChatRows",
      "visibleConversations",
      "reconciledAgentRows",
      "locallyInitiatedDMIDs",
      "hiddenConversationSnapshots",
      "localUnreadFloors",
      "sortConversations",
      "conversationListNeedsReload",
    ]) {
      expect(native).toContain(contract);
    }
    expect(page).toContain("Promise.allSettled");
    expect(page).toContain("getAgentConversations()");
    expect(page).toContain("getInstalledAgents()");
    expect(page).toContain("chatRealtimeService.subscribe");
    expect(page).toContain("shouldApplyConversationPreview");
    expect(page).toContain("reconcileLatestConversationPreviews");
    expect(page).toContain("locallyInitiatedDmIds.current");
    expect(page).toContain("activeCall?.is_live_pair");
    expect(page).toContain("saveConversationLivePairIds");
    expect(page).toContain("loadConversationInitiatedDmIds");
    expect(page).toContain("saveConversationInitiatedDmIds");
    expect(page).toContain("publishConversationUnread(ownerId, localProjection)");
    expect(page).toContain("accountScopeRef.current.isCurrent");
    expect(page).toContain("shouldResolveScriptRoomAvatar");
    expect(page).toContain("conversationPreviewText");
    expect(policy).toContain("preservingIncompleteConversationRows");
    expect(policy).toContain("reconcileLivePairConversationRows");
    expect(policy).toContain("visibleChatConversations");
    expect(policy).toContain("mergeAgentConversationRows");
    expect(repository).toContain("ttlMilliseconds: 2 * 60 * 1_000");
    expect(repository).toContain("staleRetentionMilliseconds: 30 * 24 * 60 * 60 * 1_000");
    expect(repository).toContain("conversationLoads");
    expect(repository).toContain("resetConversationRepositoryMemoryForAccount");
    expect(repository).toContain("subscribeConversationReadReceipts(");
    expect(repository).toContain("if (event.ownerId === owner)");
    expect(repository).toContain("conversations.initiated-dms.v1");
    expect(accountScope).toContain("generation");
    expect(accountScope).toContain("ticket.ownerId === this.ownerId");
    expect(unreadStore).toContain("countsByOwner");
    expect(unreadStore).toContain("aggregateConversationUnread(conversations)");
  });

  it("keeps automatic reconciliation in the background and reserves the spinner for user actions", () => {
    const page = sourceExpo("src/app/(tabs)/conversations.tsx");
    expect(page).toContain('type ConversationLoadMode = "initial" | "manual" | "background"');
    expect(page).toContain('const showRefreshIndicator = mode === "manual"');
    expect(page).toContain('if (state === "active" && ownerId) void load("background")');
    expect(page).toContain('if (event.type === "refresh_conversations")');
    expect(page).toContain('queueMicrotask(() => void load("background"))');
    expect(page).toContain('retry={() => void load("manual")}');
    expect(page).toContain('void load("manual")');
  });

  it("preserves exact read, history-clear and preference routes", () => {
    const native = sourceNative("BWChat/Services/APIService.swift");
    const expo = sourceExpo("src/api/bwchat.ts");
    for (const contract of [
      'path: "/chat/conversations/\\(Self.pathComponent(conversationType))/\\(Self.pathComponent(targetID))/preferences"',
      'baseURL + "/chat/messages/\\(Self.pathComponent(contactID))/history"',
      'baseURL + "/groups/\\(groupID)/messages/history"',
    ]) {
      expect(native).toContain(contract);
    }
    expect(expo).toContain("`/chat/conversations/${type}/${target}/preferences`");
    expect(expo).toContain("body: { is_pinned: false, is_hidden: true }");
    expect(expo).toContain("`/chat/messages/${encodeURIComponent(contactId)}/history`");
    expect(expo).toContain("`/groups/${groupId}/messages/history`");
    expect(expo).toContain("requiredData: true");
    expect(expo).toContain("requiredEnvelope: true");
  });

  it("keeps the complete list geometry, badges, menu and swipe actions", () => {
    const native = sourceNative("BWChat/Views/ContactListView.swift");
    const page = sourceExpo("src/app/(tabs)/conversations.tsx");
    for (const contract of [
      ".padding(.horizontal, 16)",
      ".frame(maxWidth: .infinity, minHeight: 42)",
      ".frame(width: 40, height: 40)",
      "private let actionWidth: CGFloat = 144",
      "size: 50",
      ".font(.system(size: 16, weight: .semibold))",
      ".font(.system(size: 14))",
      ".font(.system(size: 12))",
      "rootTabBottomScrollableClearance",
      'Color(hex: "F0A020")',
      'Color(hex: "E5484D")',
    ]) {
      expect(native).toContain(contract);
    }
    for (const contract of [
      "ROOT_HORIZONTAL_INSET = 16",
      "CONVERSATION_CARD_HEIGHT = 72",
      "ROOT_TAB_BOTTOM_CLEARANCE = 160",
      "SWIPE_ACTION_WIDTH = 144",
      "width: 40",
      "minHeight: 42",
      "size={50}",
      "fontSize: 16",
      "fontSize: 14",
      "fontSize: 12",
      'backgroundColor: "#F0A020"',
      'backgroundColor: "#E5484D"',
      'symbol="qrcode.viewfinder"',
      'symbol="person.crop.circle.badge.plus"',
    ]) {
      expect(page).toContain(contract);
    }
  });

  it("uses dynamic original avatars and remote covers without introducing page bitmap assets", () => {
    const page = sourceExpo("src/app/(tabs)/conversations.tsx");
    expect(page).toContain("<GroupMemberAvatar");
    expect(page).toContain("<Avatar uri={conversation.avatar_url}");
    expect(page).toContain("/agent-assets/${encodeURIComponent(assetId)}");
    expect(page).toContain("room.script_snapshot.cover_url");
    expect(page).not.toMatch(/require\([^)]*\.(png|jpe?g|webp)/u);
  });

  it("keeps adaptive color, localization, accessibility and owner-scoped script routing", () => {
    const page = sourceExpo("src/app/(tabs)/conversations.tsx");
    expect(page).toContain("palette(useColorScheme())");
    expect(page).toContain('t("contacts.aiCompanions")');
    expect(page).toContain('t("messages.createBot")');
    expect(page).toContain('accessibilityLabel={t("group.notifications.mute")}');
    expect(page).toContain("rememberScriptRoomConversation(conversation, ownerId)");
    expect(page).toContain("if (isSearchFocused)");
    expect(page).toContain("testID={`conversation.${conversationListIdentity(conversation)}`}");
    expect(page).not.toContain('title="创建智能体"');
    expect(page).not.toContain('Alert.alert("无法打开智能体"');
  });

  it("drives the Messages native-tab badge from owner-scoped unmuted unread", () => {
    const layout = sourceExpo("src/app/(tabs)/_layout.tsx");
    const unreadStore = sourceExpo("src/services/conversations/ConversationUnreadStore.ts");
    expect(layout).toContain('useConversationUnread(user?.user_id ?? "")');
    expect(layout).toContain('name === "messages"');
    expect(layout).toContain("return conversationUnreadBadgeText(messagesUnread)");
    expect(layout).toContain("<NativeTabs.Trigger.Badge>{badge}</NativeTabs.Trigger.Badge>");
    expect(unreadStore).toContain("return owner ? (countsByOwner.get(owner) ?? 0) : 0");
    expect(unreadStore).toContain('return normalized > 99 ? "99+" : String(normalized)');
  });
});

function sourceExpo(relativePath: string): string {
  return readFileSync(resolve(expoRoot, relativePath), "utf8");
}

function sourceNative(relativePath: string): string {
  return readFileSync(resolve(nativeRoot, relativePath), "utf8");
}
