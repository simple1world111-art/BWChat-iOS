import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import {
  endScriptRoom,
  getGroupMessages,
  getScriptRoom,
  markGroupMessagesRead,
  retryScriptTurn,
  submitScriptTurn,
} from "@/api/bwchat";
import ScriptRoomChatScreen from "@/app/script-room-chat";
import type { GroupMessage, ScriptRoom, User } from "@/models";

let mockUser: User | null = { user_id: "owner-a" } as User;
let mockRoomId = "room-1";
let mockRealtimeListener: ((event: RealtimeEvent) => void) | null = null;
let mockActiveGroupId: string | null = null;
let mockUuidCounter = 0;

const mockLoadMessages = jest.fn();
const mockLoadRoom = jest.fn();
const mockSaveMessages = jest.fn();
const mockSaveRoom = jest.fn();
const mockMarkConversationRead = jest.fn();
const mockApplyReadReceipt = jest.fn();
const mockClearConversationUnread = jest.fn();
const mockSetActiveConversation = jest.fn((type: "dm" | "group", id: string | null) => {
  if (type === "group") mockActiveGroupId = id;
});
const mockPublishLocalGroupMessage = jest.fn((ownerId: string, message: GroupMessage) => {
  if (ownerId !== mockUser?.user_id) return false;
  mockRealtimeListener?.({ type: "group_message", message });
  return true;
});

jest.mock("react-native", () => {
  const ReactModule = jest.requireActual<typeof import("react")>("react");
  const Native = jest.requireActual("react-native");
  const MockFlatList = ReactModule.forwardRef(
    (
      {
        data,
        ListFooterComponent,
        ListHeaderComponent,
        renderItem,
      }: {
        data: GroupMessage[];
        ListFooterComponent?: ReactNode;
        ListHeaderComponent?: ReactNode;
        renderItem: (item: { item: GroupMessage; index: number }) => ReactNode;
      },
      ref,
    ) => {
      ReactModule.useImperativeHandle(ref, () => ({ scrollToOffset: jest.fn() }));
      return (
        <Native.View>
          {ListFooterComponent}
          {data.map((item, index) => (
            <ReactModule.Fragment key={item.id}>{renderItem({ item, index })}</ReactModule.Fragment>
          ))}
          {ListHeaderComponent}
        </Native.View>
      );
    },
  );
  const MockedNative = Object.create(Native) as typeof Native;
  Object.defineProperty(MockedNative, "FlatList", { value: MockFlatList });
  return MockedNative;
});

jest.mock("expo-router", () => {
  const ReactModule = jest.requireActual<typeof import("react")>("react");
  const { Text: MockText } = jest.requireActual("react-native");
  return {
    router: { back: jest.fn() },
    Stack: {
      Screen: ({
        options,
      }: {
        options?: { headerLeft?: () => ReactNode; headerRight?: () => ReactNode; title?: string };
      }) => (
        <>
          <MockText>{options?.title ?? ""}</MockText>
          {options?.headerLeft?.()}
          {options?.headerRight?.()}
        </>
      ),
    },
    useFocusEffect: (callback: () => void | (() => void)) => {
      ReactModule.useEffect(callback, [callback]);
    },
    useLocalSearchParams: () => ({ roomId: mockRoomId }),
  };
});

jest.mock("expo-crypto", () => ({ randomUUID: () => `uuid-${++mockUuidCounter}` }));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
}));

jest.mock("expo-linear-gradient", () => ({
  LinearGradient: ({ children }: { children: ReactNode }) => {
    const { View: MockView } = jest.requireActual("react-native");
    return <MockView>{children}</MockView>;
  },
}));

jest.mock("expo-symbols", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return { SymbolView: ({ name }: { name: string }) => <MockText>{name}</MockText> };
});

jest.mock("@expo/ui/community/menu", () => ({
  MenuView: ({ children }: { children: ReactNode }) => {
    const { View: MockView } = jest.requireActual("react-native");
    return <MockView>{children}</MockView>;
  },
}));

jest.mock("@/api/bwchat", () => ({
  endScriptRoom: jest.fn(),
  getGroupMessages: jest.fn(),
  getScriptRoom: jest.fn(),
  markGroupMessagesRead: jest.fn(),
  retryScriptTurn: jest.fn(),
  submitScriptTurn: jest.fn(),
}));

jest.mock("@/components/AuthenticatedImage", () => {
  const { View: MockView } = jest.requireActual("react-native");
  return {
    AuthenticatedImage: ({ uri }: { uri: string }) => <MockView accessibilityLabel={uri} />,
  };
});

jest.mock("@/components/TopToast", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return {
    TopToast: ({ message }: { message: string | null }) => (
      <MockText accessibilityLabel="script-room-toast">{message ?? ""}</MockText>
    ),
  };
});

jest.mock("@/providers/AuthProvider", () => ({
  useAuth: () => ({ user: mockUser }),
}));

jest.mock("@/providers/LocalizationProvider", () => ({
  useLocalization: () => ({ selectedLanguage: "system" }),
}));

jest.mock("@/services/conversations/ConversationReadService", () => ({
  markConversationRead: (...args: unknown[]) => mockMarkConversationRead(...args),
}));

jest.mock("@/services/conversations/ConversationRepository", () => ({
  applyConversationReadReceipt: (...args: unknown[]) => mockApplyReadReceipt(...args),
  clearConversationUnreadLocally: (...args: unknown[]) => mockClearConversationUnread(...args),
}));

jest.mock("@/services/realtime/ChatRealtimeService", () => ({
  chatRealtimeService: {
    isConversationActive: (_type: "dm" | "group", id: string) => mockActiveGroupId === id,
    publishLocalGroupMessage: (...args: [string, GroupMessage]) =>
      mockPublishLocalGroupMessage(...args),
    setActiveConversation: (...args: ["dm" | "group", string | null]) =>
      mockSetActiveConversation(...args),
    subscribe: (listener: (event: RealtimeEvent) => void) => {
      mockRealtimeListener = listener;
      return () => {
        if (mockRealtimeListener === listener) mockRealtimeListener = null;
      };
    },
  },
}));

jest.mock("@/services/scripts/ScriptRoomNavigationStore", () => ({
  clearPendingScriptRoomConversation: jest.fn(),
  pendingScriptRoomConversation: jest.fn(() => null),
}));

jest.mock("@/services/scripts/ScriptRoomRepository", () => ({
  loadCachedScriptMessages: (...args: unknown[]) => mockLoadMessages(...args),
  loadCachedScriptRoom: (...args: unknown[]) => mockLoadRoom(...args),
  saveCachedScriptMessages: (...args: unknown[]) => mockSaveMessages(...args),
  saveCachedScriptRoom: (...args: unknown[]) => mockSaveRoom(...args),
}));

const mockEndRoom = jest.mocked(endScriptRoom);
const mockGetMessages = jest.mocked(getGroupMessages);
const mockGetRoom = jest.mocked(getScriptRoom);
const mockMarkGroupRead = jest.mocked(markGroupMessagesRead);
const mockRetryTurn = jest.mocked(retryScriptTurn);
const mockSubmitTurn = jest.mocked(submitScriptTurn);

describe("Script Room screen lifecycle, read and transaction parity", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser = { user_id: "owner-a" } as User;
    mockRoomId = "room-1";
    mockRealtimeListener = null;
    mockActiveGroupId = null;
    mockUuidCounter = 0;
    mockLoadRoom.mockResolvedValue(null);
    mockLoadMessages.mockResolvedValue([]);
    mockSaveRoom.mockResolvedValue(undefined);
    mockSaveMessages.mockResolvedValue([]);
    mockGetRoom.mockResolvedValue(room("room-1", "owner-a"));
    mockGetMessages.mockResolvedValue({ messages: [], hasMore: false });
    mockMarkGroupRead.mockResolvedValue(null);
    mockMarkConversationRead.mockResolvedValue(undefined);
    mockApplyReadReceipt.mockResolvedValue(undefined);
    mockClearConversationUnread.mockResolvedValue(undefined);
    mockEndRoom.mockResolvedValue(undefined);
  });

  afterEach(() => cleanup());

  it("loads an authoritative room, exposes native control semantics and uses a plain initial read", async () => {
    const view = await render(<ScriptRoomChatScreen />);

    await waitFor(() => expect(view.getByText("剧情 owner-a")).toBeTruthy());
    expect(view.getByLabelText("返回").props.accessibilityRole).toBe("button");
    expect(view.getByLabelText("更多").props.accessibilityRole).toBe("button");
    expect(view.getByLabelText("主角")).toBeTruthy();
    expect(view.getByLabelText("以角色身份推进剧情…")).toBeTruthy();
    expect(view.getByLabelText("发送回合").props.accessibilityState).toEqual({ disabled: true });
    await waitFor(() => expect(mockMarkGroupRead).toHaveBeenCalledTimes(1));
    expect(mockMarkGroupRead).toHaveBeenCalledWith(42);
    expect(mockMarkConversationRead).not.toHaveBeenCalled();
    expect(mockClearConversationUnread).toHaveBeenCalledWith("owner-a", "group", "42");

    await fireEvent.changeText(view.getByTestId("script-room-input"), "继续剧情");
    await waitFor(() =>
      expect(view.getByLabelText("发送回合").props.accessibilityState).toEqual({ disabled: false }),
    );
  });

  it("marks the native-visible room before history synchronization completes", async () => {
    const history = deferred<Awaited<ReturnType<typeof getGroupMessages>>>();
    mockGetMessages.mockReturnValueOnce(history.promise);
    const view = await render(<ScriptRoomChatScreen />);

    await waitFor(() => expect(view.getByText("剧情 owner-a")).toBeTruthy());
    await waitFor(() => expect(mockMarkGroupRead).toHaveBeenCalledWith(42));
    expect(mockSetActiveConversation).toHaveBeenCalledWith("group", "42");

    await act(async () => {
      history.resolve({ messages: [], hasMore: false });
      await history.promise;
    });
    expect(mockMarkGroupRead).toHaveBeenCalledTimes(1);
  });

  it("single-flights rapid submit and retry while preserving response order", async () => {
    mockSubmitTurn.mockResolvedValueOnce({
      turn_id: "turn-1",
      status: "failed",
      user_message: message(10, "玩家推进"),
    });
    mockRetryTurn.mockResolvedValueOnce({
      turn_id: "turn-1",
      status: "completed",
      ai_message: message(11, "AI 接续", "ai"),
    });
    const view = await render(<ScriptRoomChatScreen />);
    await waitFor(() => expect(view.getByText("剧情 owner-a")).toBeTruthy());

    await fireEvent.changeText(view.getByTestId("script-room-input"), "\u0085继续剧情\u2029");
    await waitFor(() =>
      expect(view.getByTestId("script-room-send").props.accessibilityState).toEqual({
        disabled: false,
      }),
    );
    const sendButton = view.getByTestId("script-room-send");
    await fireEvent.press(sendButton);
    await fireEvent.press(sendButton);
    expect(mockSubmitTurn).toHaveBeenCalledTimes(1);
    expect(mockSubmitTurn).toHaveBeenCalledWith("room-1", "继续剧情", "UUID-1");
    await waitFor(() => expect(view.getByText("玩家推进")).toBeTruthy());
    expect(mockPublishLocalGroupMessage).toHaveBeenCalledTimes(1);
    expect(mockMarkConversationRead).not.toHaveBeenCalled();
    const retryButton = view.getByTestId("script-room-retry-turn");
    expect(retryButton.props.accessibilityRole).toBe("button");

    await fireEvent.press(retryButton);
    await fireEvent.press(retryButton);
    expect(mockRetryTurn).toHaveBeenCalledTimes(1);
    expect(mockRetryTurn).toHaveBeenCalledWith("room-1", "turn-1");
    await waitFor(() => expect(view.getByText("AI 接续")).toBeTruthy());
  });

  it("restores failed input but ignores the old owner's late submit after an account change", async () => {
    const failed = deferred<Awaited<ReturnType<typeof submitScriptTurn>>>();
    mockSubmitTurn.mockReturnValueOnce(failed.promise);
    mockGetRoom
      .mockResolvedValueOnce(room("room-1", "owner-a"))
      .mockResolvedValueOnce(room("room-1", "owner-b"));
    const view = await render(<ScriptRoomChatScreen />);
    await waitFor(() => expect(view.getByText("剧情 owner-a")).toBeTruthy());
    await fireEvent.changeText(view.getByTestId("script-room-input"), "A 的输入");
    await fireEvent.press(view.getByTestId("script-room-send"));

    mockUser = { user_id: "owner-b" } as User;
    await act(async () => {
      view.rerender(<ScriptRoomChatScreen />);
      await Promise.resolve();
    });
    await waitFor(() => expect(view.getByText("剧情 owner-b")).toBeTruthy());
    expect(view.getByTestId("script-room-input").props.value).toBe("");

    await act(async () => {
      failed.reject(new Error("A 的迟到失败"));
      await failed.promise.catch(() => undefined);
    });
    expect(view.getByTestId("script-room-input").props.value).toBe("");
    expect(view.getByLabelText("script-room-toast").props.children).toBe("");
  });

  it("preserves the raw route room ID and never activates a non-positive group", async () => {
    mockRoomId = " room/1 ";
    mockGetRoom.mockResolvedValueOnce({ ...room(" room/1 ", "owner-a"), group_id: -42 });
    const view = await render(<ScriptRoomChatScreen />);

    await waitFor(() => expect(view.getByText("剧情 owner-a")).toBeTruthy());
    expect(mockGetRoom).toHaveBeenCalledWith(" room/1 ");
    expect(mockSetActiveConversation).not.toHaveBeenCalledWith("group", "-42");
    expect(mockMarkGroupRead).not.toHaveBeenCalledWith(-42);
  });

  it("keeps A to B to A loads isolated and sends through-message reads only for visible realtime", async () => {
    const firstA = deferred<ScriptRoom>();
    mockGetRoom
      .mockReturnValueOnce(firstA.promise)
      .mockResolvedValueOnce(room("room-1", "owner-b"))
      .mockResolvedValueOnce(room("room-1", "owner-a-new"));
    const view = await render(<ScriptRoomChatScreen />);
    await waitFor(() => expect(mockGetRoom).toHaveBeenCalledTimes(1));

    mockUser = { user_id: "owner-b" } as User;
    await act(async () => {
      view.rerender(<ScriptRoomChatScreen />);
      await Promise.resolve();
    });
    await waitFor(() => expect(view.getByText("剧情 owner-b")).toBeTruthy());

    mockUser = { user_id: "owner-a" } as User;
    await act(async () => {
      view.rerender(<ScriptRoomChatScreen />);
      await Promise.resolve();
    });
    await waitFor(() => expect(view.getByText("剧情 owner-a-new")).toBeTruthy());

    await act(async () => {
      firstA.resolve(room("room-1", "owner-a-old"));
      await firstA.promise;
    });
    expect(view.queryByText("剧情 owner-a-old")).toBeNull();
    expect(view.getByText("剧情 owner-a-new")).toBeTruthy();

    mockMarkConversationRead.mockClear();
    await act(async () => {
      mockRealtimeListener?.({ type: "group_message", message: message(77, "实时新消息", "ai") });
      await Promise.resolve();
    });
    await waitFor(() => expect(view.getByText("实时新消息")).toBeTruthy());
    expect(mockMarkConversationRead).toHaveBeenCalledTimes(1);
    expect(mockMarkConversationRead).toHaveBeenCalledWith("owner-a", "group", "42", 77);
    expect(mockClearConversationUnread).toHaveBeenLastCalledWith("owner-a", "group", "42");
  });

  it("ignores a previous owner's late room-load failure", async () => {
    const oldLoad = deferred<ScriptRoom>();
    mockGetRoom
      .mockReturnValueOnce(oldLoad.promise)
      .mockResolvedValueOnce(room("room-1", "owner-b"));
    const view = await render(<ScriptRoomChatScreen />);
    await waitFor(() => expect(mockGetRoom).toHaveBeenCalledTimes(1));

    mockUser = { user_id: "owner-b" } as User;
    await act(async () => {
      view.rerender(<ScriptRoomChatScreen />);
      await Promise.resolve();
    });
    await waitFor(() => expect(view.getByText("剧情 owner-b")).toBeTruthy());

    await act(async () => {
      oldLoad.reject(new Error("owner-a late load failure"));
      await oldLoad.promise.catch(() => undefined);
    });
    expect(view.getByText("剧情 owner-b")).toBeTruthy();
    expect(view.getByLabelText("script-room-toast").props.children).toBe("");
  });

  it("matches the native terminal restore failure without inventing an inline retry action", async () => {
    mockGetRoom.mockRejectedValueOnce(new Error("网络离线"));
    const view = await render(<ScriptRoomChatScreen />);

    await waitFor(() => expect(view.getByText("无法恢复房间")).toBeTruthy());
    expect(view.getAllByText("网络离线")).toHaveLength(2);
    expect(view.getByLabelText("script-room-toast").props.children).toBe("网络离线");
    expect(view.getByText("bubble.left.and.exclamationmark.bubble.right")).toBeTruthy();
    expect(view.queryByText("重试")).toBeNull();
    expect(view.getByLabelText("发送回合").props.accessibilityState).toEqual({ disabled: true });
  });
});

type RealtimeEvent =
  | { type: "group_message"; message: GroupMessage }
  | {
      type: "script_turn_state";
      state: {
        room_id: string;
        turn_id: string;
        status: "queued" | "generating" | "completed" | "failed";
        message?: string;
      };
    };

function room(roomId: string, owner: string): ScriptRoom {
  return {
    room_id: roomId,
    script_id: "script-1",
    group_id: 42,
    status: "active",
    player_role_id: "hero",
    assignments: [{ role_id: "hero", actor_type: "user", user_id: owner }],
    script_snapshot: {
      title: `剧情 ${owner}`,
      synopsis: "故事简介",
      cover_url: "",
      roles: [
        {
          role_id: "hero",
          name: "主角",
          gender: "unspecified",
          avatar_url: "",
          description: "",
          sort_order: 0,
        },
      ],
    },
  };
}

function message(id: number, content: string, actorType: "user" | "ai" = "user"): GroupMessage {
  return {
    id,
    group_id: 42,
    sender_id: `script-role:${actorType}`,
    msg_type: "text",
    content,
    timestamp: `2026-08-08T00:00:${String(id % 60).padStart(2, "0")}Z`,
    sender_nickname: actorType === "user" ? "玩家" : "AI",
    sender_avatar: "",
    mention_all: false,
    version: 1,
    script_context: {
      room_id: "room-1",
      role_id: "hero",
      actor_type: actorType,
      turn_id: "turn-1",
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, reject, resolve };
}
