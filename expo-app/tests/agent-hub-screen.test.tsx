import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { AppState } from "react-native";
import type { ReactNode } from "react";

import AgentHubScreen from "@/app/agent-hub";
import type {
  AgentConversation,
  AgentRuntimeConfig,
  AgentSummary,
  Conversation,
  User,
} from "@/models";

let mockOwner: User | null = user("owner-a");
let mockAgentUpdateListener: ((agent: AgentSummary) => void) | null = null;
let mockUuid = 0;
const mockPush = jest.fn();
const mockGetRuntime = jest.fn();
const mockGetInstalled = jest.fn();
const mockGetAgentConversations = jest.fn();
const mockGetConversationSnapshot = jest.fn();
const mockGetWallet = jest.fn();
const mockCreateConversation = jest.fn();
const mockUninstall = jest.fn();
const mockLoadCache = jest.fn();
const mockSaveCache = jest.fn();
const mockRememberAgent = jest.fn();
const mockRememberScriptRoom = jest.fn();

jest.mock("expo-router", () => {
  const React = jest.requireActual<typeof import("react")>("react");
  return {
    router: { push: (...args: unknown[]) => mockPush(...args) },
    Stack: {
      Screen: ({ options }: { options?: { headerRight?: () => ReactNode } }) => (
        <>{options?.headerRight?.()}</>
      ),
    },
    useFocusEffect: (callback: () => void | (() => void)) => {
      React.useEffect(callback, [callback]);
    },
  };
});

jest.mock("@expo/ui/community/menu", () => {
  const {
    Pressable: MockPressable,
    Text: MockText,
    View: MockView,
  } = jest.requireActual("react-native");
  return {
    MenuView: ({
      actions,
      children,
      onPressAction,
    }: {
      actions: { id?: string; title: string }[];
      children?: ReactNode;
      onPressAction?(event: { nativeEvent: { event: string } }): void;
    }) => (
      <MockView>
        {children}
        {actions.map((action) => (
          <MockPressable
            accessibilityLabel={`menu:${action.title}`}
            key={action.id ?? action.title}
            onPress={() => onPressAction?.({ nativeEvent: { event: action.id ?? action.title } })}
          >
            <MockText>{action.title}</MockText>
          </MockPressable>
        ))}
      </MockView>
    ),
  };
});

jest.mock("expo-crypto", () => ({
  randomUUID: () => `agent-hub-key-${++mockUuid}`,
}));

jest.mock("expo-linear-gradient", () => {
  const { View: MockView } = jest.requireActual("react-native");
  return { LinearGradient: (props: object) => <MockView {...props} /> };
});

jest.mock("expo-symbols", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return { SymbolView: ({ name }: { name: string }) => <MockText>{name}</MockText> };
});

jest.mock("@/api/bwchat", () => ({
  createAgentConversation: (...args: unknown[]) => mockCreateConversation(...args),
  getAgentConversations: (...args: unknown[]) => mockGetAgentConversations(...args),
  getAgentRuntimeConfig: (...args: unknown[]) => mockGetRuntime(...args),
  getConversationSyncSnapshot: (...args: unknown[]) => mockGetConversationSnapshot(...args),
  getInstalledAgents: (...args: unknown[]) => mockGetInstalled(...args),
  getWalletBalance: (...args: unknown[]) => mockGetWallet(...args),
  uninstallAgent: (...args: unknown[]) => mockUninstall(...args),
}));

jest.mock("@/components/AuthenticatedImage", () => {
  const { View: MockView } = jest.requireActual("react-native");
  return { AuthenticatedImage: (props: object) => <MockView {...props} /> };
});

jest.mock("@/providers/AuthProvider", () => ({
  useAuth: () => ({ user: mockOwner }),
}));

jest.mock("@/providers/LocalizationProvider", () => ({
  useLocalization: () => ({
    t: (key: string) => (key === "time.yesterday" ? "昨天" : `[${key}]`),
  }),
}));

jest.mock("@/services/agents/AgentCatalogRepository", () => ({
  loadCachedAgentCatalog: (...args: unknown[]) => mockLoadCache(...args),
  saveAgentCatalog: (...args: unknown[]) => mockSaveCache(...args),
}));

jest.mock("@/services/agents/AgentEditNavigationStore", () => ({
  rememberAgentForEditing: (...args: unknown[]) => mockRememberAgent(...args),
  subscribeAgentUpdates: (listener: (agent: AgentSummary) => void) => {
    mockAgentUpdateListener = listener;
    return () => {
      if (mockAgentUpdateListener === listener) mockAgentUpdateListener = null;
    };
  },
}));

jest.mock("@/services/scripts/ScriptRoomNavigationStore", () => ({
  rememberScriptRoomConversation: (...args: unknown[]) => mockRememberScriptRoom(...args),
}));

describe("AgentHub screen account and transaction parity", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOwner = user("owner-a");
    mockAgentUpdateListener = null;
    mockUuid = 0;
    jest.spyOn(AppState, "addEventListener").mockReturnValue({ remove: jest.fn() });
    mockLoadCache.mockResolvedValue(null);
    mockSaveCache.mockResolvedValue(undefined);
    mockGetRuntime.mockResolvedValue(runtimeConfig());
    mockGetInstalled.mockResolvedValue([agent("agent-a", "智能体 A", true)]);
    mockGetAgentConversations.mockResolvedValue([]);
    mockGetConversationSnapshot.mockResolvedValue({ conversations: [] });
    mockGetWallet.mockResolvedValue(wallet(42));
    mockCreateConversation.mockResolvedValue(agentConversation("conversation-new", "agent-a"));
    mockUninstall.mockResolvedValue(undefined);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  it("loads all five remote snapshots independently and preserves fulfilled content", async () => {
    mockGetRuntime.mockRejectedValueOnce(new Error("runtime offline"));
    await render(<AgentHubScreen />);

    await waitFor(() => expect(screen.getByText("智能体 A")).toBeTruthy());
    expect(mockGetRuntime).toHaveBeenCalledTimes(1);
    expect(mockGetInstalled).toHaveBeenCalledTimes(1);
    expect(mockGetAgentConversations).toHaveBeenCalledTimes(1);
    expect(mockGetConversationSnapshot).toHaveBeenCalledTimes(1);
    expect(mockGetWallet).toHaveBeenCalledTimes(1);
    expect(screen.getByText("runtime offline")).toBeTruthy();
    expect(mockSaveCache).toHaveBeenCalledWith(
      "owner-a",
      expect.objectContaining({
        installedAgents: [expect.objectContaining({ id: "agent-a" })],
        spendableBalance: 42,
      }),
    );
  });

  it("remounts account state before the new owner cache resolves", async () => {
    mockLoadCache.mockImplementation(async (ownerId: string) =>
      cachedSnapshot([
        agent(ownerId === "owner-a" ? "agent-a" : "agent-b", `智能体 ${ownerId}`, true),
      ]),
    );
    const view = await render(<AgentHubScreen />);
    await waitFor(() => expect(screen.getByText("智能体 owner-a")).toBeTruthy());

    mockOwner = user("owner-b");
    await act(async () => {
      view.rerender(<AgentHubScreen />);
      await Promise.resolve();
    });

    expect(screen.queryByText("智能体 owner-a")).toBeNull();
    await waitFor(() => expect(screen.getByText("智能体 owner-b")).toBeTruthy());
    expect(mockLoadCache).toHaveBeenCalledWith("owner-b");
  });

  it("drops a late old-account five-domain load after the keyed screen unmounts", async () => {
    const oldInstalled = deferred<AgentSummary[]>();
    mockLoadCache.mockResolvedValue(null);
    mockGetInstalled
      .mockReturnValueOnce(oldInstalled.promise)
      .mockResolvedValueOnce([agent("agent-b", "智能体 owner-b", true)]);
    const view = await render(<AgentHubScreen />);
    await waitFor(() => expect(mockGetInstalled).toHaveBeenCalledTimes(1));

    mockOwner = user("owner-b");
    await act(async () => {
      view.rerender(<AgentHubScreen />);
      await Promise.resolve();
    });
    await screen.findByText("智能体 owner-b");

    await act(async () => {
      oldInstalled.resolve([agent("agent-a", "智能体 owner-a", true)]);
      await oldInstalled.promise;
    });

    expect(screen.queryByText("智能体 owner-a")).toBeNull();
    expect(mockSaveCache).not.toHaveBeenCalledWith(
      "owner-a",
      expect.objectContaining({
        installedAgents: [expect.objectContaining({ id: "agent-a" })],
      }),
    );
  });

  it("opens an existing conversation without creating or installing anything", async () => {
    const existing = agentConversation("conversation-existing", "agent-a");
    mockLoadCache.mockResolvedValue(
      cachedSnapshot([agent("agent-a", "智能体 A", true)], [existing]),
    );
    await render(<AgentHubScreen />);
    await waitFor(() => expect(screen.getByText("智能体 A")).toBeTruthy());

    await fireEvent.press(screen.getByLabelText("智能体 A，开始一段新对话，聊天"));
    expect(mockCreateConversation).not.toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/agent-chat",
      params: {
        conversationId: "conversation-existing",
        agentId: "agent-a",
        name: "智能体 agent-a",
        avatarId: "",
      },
    });
  });

  it("creates one conversation for same-frame taps and navigates only after success", async () => {
    const creation = deferred<AgentConversation>();
    mockLoadCache.mockResolvedValue(cachedSnapshot([agent("agent-a", "智能体 A", true)]));
    mockCreateConversation.mockReturnValueOnce(creation.promise);
    await render(<AgentHubScreen />);
    const row = await screen.findByLabelText("智能体 A，开始一段新对话，聊天");

    await fireEvent.press(row);
    await fireEvent.press(row);
    expect(mockCreateConversation).toHaveBeenCalledTimes(1);
    expect(mockCreateConversation).toHaveBeenCalledWith("agent-a", "hello", "agent-hub-key-1");
    expect(mockPush).not.toHaveBeenCalled();

    const created = agentConversation("conversation-new", "agent-a");
    await act(async () => {
      creation.resolve(created);
      await creation.promise;
    });
    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith(expect.objectContaining({ pathname: "/agent-chat" })),
    );
    expect(mockSaveCache).toHaveBeenCalledWith(
      "owner-a",
      expect.objectContaining({ conversations: [created] }),
    );
  });

  it("drops an old account conversation response after the keyed account screen unmounts", async () => {
    const creation = deferred<AgentConversation>();
    mockLoadCache.mockImplementation(async (ownerId: string) =>
      cachedSnapshot([
        agent(ownerId === "owner-a" ? "agent-a" : "agent-b", `智能体 ${ownerId}`, true),
      ]),
    );
    mockCreateConversation.mockReturnValueOnce(creation.promise);
    const view = await render(<AgentHubScreen />);
    const oldRow = await screen.findByLabelText("智能体 owner-a，开始一段新对话，聊天");
    await fireEvent.press(oldRow);

    mockOwner = user("owner-b");
    await act(async () => {
      view.rerender(<AgentHubScreen />);
      await Promise.resolve();
    });
    await screen.findByText("智能体 owner-b");

    const created = agentConversation("conversation-old-owner", "agent-a");
    await act(async () => {
      creation.resolve(created);
      await creation.promise;
    });

    expect(mockPush).not.toHaveBeenCalled();
    expect(mockSaveCache).not.toHaveBeenCalledWith(
      "owner-a",
      expect.objectContaining({ conversations: expect.arrayContaining([created]) }),
    );
  });

  it("refreshes runtime flags after a native 6000-series conversation capability error", async () => {
    const capabilityError = Object.assign(new Error("当前能力不可用"), {
      name: "APIError",
      payload: { detail: { code: 6201 } },
    });
    mockLoadCache.mockResolvedValue(cachedSnapshot([agent("agent-a", "智能体 A", true)]));
    mockCreateConversation.mockRejectedValueOnce(capabilityError);
    await render(<AgentHubScreen />);
    const row = await screen.findByLabelText("智能体 A，开始一段新对话，聊天");

    await fireEvent.press(row);

    await waitFor(() => expect(mockGetRuntime).toHaveBeenCalledTimes(1));
    expect(screen.getByText("当前能力不可用")).toBeTruthy();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("matches native error ordering when the capability refresh also fails", async () => {
    const capabilityError = Object.assign(new Error("当前能力不可用"), {
      name: "APIError",
      payload: { detail: { code: 6201 } },
    });
    mockLoadCache.mockResolvedValue(cachedSnapshot([agent("agent-a", "智能体 A", true)]));
    mockCreateConversation.mockRejectedValueOnce(capabilityError);
    mockGetRuntime.mockRejectedValueOnce(new Error("运行配置刷新失败"));
    await render(<AgentHubScreen />);

    await fireEvent.press(await screen.findByLabelText("智能体 A，开始一段新对话，聊天"));

    await waitFor(() => expect(screen.getByText("运行配置刷新失败")).toBeTruthy());
    expect(screen.queryByText("当前能力不可用")).toBeNull();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("persists a Creator handoff even when all five forced refresh domains fail", async () => {
    let stored = cachedSnapshot([agent("agent-a", "旧名称", true)]);
    mockLoadCache.mockImplementation(async () => stored);
    mockSaveCache.mockImplementation(async (_ownerId: string, value: typeof stored.value) => {
      stored = { ...stored, value };
    });
    await render(<AgentHubScreen />);
    await screen.findByText("旧名称");
    mockGetRuntime.mockRejectedValueOnce(new Error("runtime failed"));
    mockGetInstalled.mockRejectedValueOnce(new Error("installed failed"));
    mockGetAgentConversations.mockRejectedValueOnce(new Error("conversations failed"));
    mockGetConversationSnapshot.mockRejectedValueOnce(new Error("scripts failed"));
    mockGetWallet.mockRejectedValueOnce(new Error("wallet failed"));

    await act(async () => {
      mockAgentUpdateListener?.(agent("agent-a", "新名称", true));
      await Promise.resolve();
    });

    await screen.findByText("新名称");
    await waitFor(() =>
      expect(mockSaveCache).toHaveBeenCalledWith(
        "owner-a",
        expect.objectContaining({
          installedAgents: [
            expect.objectContaining({ id: "agent-a", profile: { name: "新名称" } }),
          ],
        }),
      ),
    );
    await waitFor(() => expect(mockGetWallet).toHaveBeenCalledTimes(1));
    expect(screen.getByText("runtime failed")).toBeTruthy();
  });

  it("uses native long-press menu ownership and removes only after DELETE succeeds", async () => {
    const removal = deferred<void>();
    mockLoadCache.mockResolvedValue(
      cachedSnapshot([agent("owned", "自有智能体", true), agent("other", "别人的智能体", false)]),
    );
    mockUninstall.mockReturnValueOnce(removal.promise);
    await render(<AgentHubScreen />);
    await waitFor(() => expect(screen.getByText("自有智能体")).toBeTruthy());

    expect(screen.getAllByLabelText("menu:调整智能体")).toHaveLength(1);
    await fireEvent.press(screen.getByLabelText("menu:调整智能体"));
    expect(mockRememberAgent).toHaveBeenCalledWith(
      expect.objectContaining({ id: "owned" }),
      "owner-a",
    );
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/agent-creator",
      params: { agentId: "owned" },
    });

    const removeButtons = screen.getAllByLabelText("menu:从我的智能体中移除");
    await fireEvent.press(removeButtons[0]!);
    expect(mockUninstall).toHaveBeenCalledWith("owned");
    expect(screen.getByText("自有智能体")).toBeTruthy();

    await act(async () => {
      removal.resolve(undefined);
      await removal.promise;
    });
    await waitFor(() => expect(screen.queryByText("自有智能体")).toBeNull());
    expect(screen.getByText("别人的智能体")).toBeTruthy();
  });

  it("drops an old account uninstall response after the keyed screen unmounts", async () => {
    const removal = deferred<void>();
    mockLoadCache.mockImplementation(async (ownerId: string) =>
      cachedSnapshot([
        agent(ownerId === "owner-a" ? "agent-a" : "agent-b", `智能体 ${ownerId}`, true),
      ]),
    );
    mockUninstall.mockReturnValueOnce(removal.promise);
    const view = await render(<AgentHubScreen />);
    await screen.findByText("智能体 owner-a");
    await fireEvent.press(screen.getByLabelText("menu:从我的智能体中移除"));

    mockOwner = user("owner-b");
    await act(async () => {
      view.rerender(<AgentHubScreen />);
      await Promise.resolve();
    });
    await screen.findByText("智能体 owner-b");

    await act(async () => {
      removal.resolve(undefined);
      await removal.promise;
    });

    expect(screen.getByText("智能体 owner-b")).toBeTruthy();
    expect(mockSaveCache).not.toHaveBeenCalledWith(
      "owner-a",
      expect.objectContaining({ installedAgents: [] }),
    );
  });

  it("hands a valid joined script row to ScriptRoom and ignores absent routes", async () => {
    const script = scriptConversation("script-row", "room-1");
    mockLoadCache.mockResolvedValue(cachedSnapshot([], [], [script]));
    await render(<AgentHubScreen />);
    await waitFor(() => expect(screen.getByText("script-row")).toBeTruthy());

    await fireEvent.press(screen.getByLabelText("script-row，剧本，继续剧情"));
    expect(mockRememberScriptRoom).toHaveBeenCalledWith(script, "owner-a");
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/script-room-chat",
      params: { roomId: "room-1" },
    });
    expect(screen.queryByText("不存在的剧本")).toBeNull();
  });
});

function user(userId: string): User {
  return {
    user_id: userId,
    username: userId,
    nickname: userId,
    avatar_url: "",
    bio: "",
    gender: "",
    birthday: "",
    location: "",
    following_count: 0,
    follower_count: 0,
    followed_by_me: false,
    follows_me: false,
    is_friend: false,
  };
}

function runtimeConfig(): AgentRuntimeConfig {
  return {
    agents_enabled: true,
    image_input_enabled: true,
    paid_images_enabled: true,
    paid_videos_enabled: false,
    vision: { max_images_per_turn: 2 },
  };
}

function wallet(spendableBalance: number) {
  return {
    currency: "gold_coin" as const,
    gold_coin_balance: spendableBalance,
    activity_cat_food_balance: 0,
    spendable_balance: spendableBalance,
    chat_money_frozen_gold_coin_balance: 0,
  };
}

function agent(id: string, name: string, isOwner: boolean): AgentSummary {
  return {
    id,
    is_owner: isOwner,
    profile: { name },
    greetings: [{ id: "hello", text: "你好" }],
  };
}

function agentConversation(id: string, agentId: string): AgentConversation {
  return {
    id,
    title: `智能体 ${agentId}`,
    status: "active",
    agent_id: agentId,
    agent_version_id: "version-1",
    agent_profile: { name: `智能体 ${agentId}` },
    agent_capabilities: { paid_images: false, paid_videos: false },
    created_at: "2026-08-08T00:00:00Z",
    updated_at: "2026-08-08T00:00:00Z",
  };
}

function scriptConversation(id: string, roomId: string): Conversation {
  return {
    type: "group",
    id,
    name: id,
    avatar_url: "",
    last_message: "继续剧情",
    last_message_time: "2026-08-08T00:00:00Z",
    unread_count: 0,
    conversation_kind: "script-room",
    script_room_id: roomId,
    is_muted: false,
  };
}

function cachedSnapshot(
  installedAgents: AgentSummary[],
  conversations: AgentConversation[] = [],
  joinedScriptRooms: Conversation[] = [],
) {
  return {
    value: { installedAgents, conversations, joinedScriptRooms },
    updatedAt: Date.now(),
    expiresAt: Date.now() + 300_000,
    isStale: false,
  };
}

function deferred<Value>(): {
  promise: Promise<Value>;
  resolve(value: Value): void;
} {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
