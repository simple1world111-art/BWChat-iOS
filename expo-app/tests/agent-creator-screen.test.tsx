import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";

import AgentCreatorScreen from "@/app/agent-creator";
import type { AgentSummary, User } from "@/models";

let mockOwner: User | null = user("owner-a");
let mockParams: { agentId?: string } = {};
let mockUuid = 0;
const mockBack = jest.fn();
const mockGetAgent = jest.fn();
const mockLaunchImageLibrary = jest.fn();
const mockMakePreview = jest.fn();
const mockRemoveTemporaryFile = jest.fn();
const mockExecuteTransaction = jest.fn();
const mockInvalidateCatalog = jest.fn();
const mockClearPending = jest.fn();
const mockNotifyUpdated = jest.fn();

jest.mock("expo-router", () => ({
  router: { back: (...args: unknown[]) => mockBack(...args) },
  Stack: {
    Screen: ({ options }: { options?: { headerRight?: () => ReactNode } }) => (
      <>{options?.headerRight?.()}</>
    ),
  },
  useLocalSearchParams: () => mockParams,
}));

jest.mock("expo-crypto", () => ({
  randomUUID: () => `agent-creator-key-${++mockUuid}`,
}));

jest.mock("expo-image", () => {
  const { View: MockView } = jest.requireActual("react-native");
  return { Image: (props: object) => <MockView {...props} /> };
});

jest.mock("expo-image-picker", () => ({
  launchImageLibraryAsync: (...args: unknown[]) => mockLaunchImageLibrary(...args),
}));

jest.mock("expo-symbols", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return { SymbolView: ({ name }: { name: string }) => <MockText>{name}</MockText> };
});

jest.mock("@expo/ui/swift-ui", () => {
  const { Text: MockText, View: MockView } = jest.requireActual("react-native");
  return {
    Host: ({ children, ...props }: { children?: ReactNode }) => (
      <MockView {...props}>{children}</MockView>
    ),
    Picker: ({ children, label }: { children?: ReactNode; label: string }) => (
      <MockView>
        <MockText>{label}</MockText>
        {children}
      </MockView>
    ),
    Text: ({ children }: { children?: ReactNode }) => <MockText>{children}</MockText>,
    Toggle: ({ label, isOn }: { label: string; isOn: boolean }) => (
      <MockText accessibilityLabel={label}>{String(isOn)}</MockText>
    ),
  };
});

jest.mock("@expo/ui/swift-ui/modifiers", () => ({
  disabled: () => "disabled",
  padding: (value: object) => value,
  pickerStyle: (value: string) => value,
  tag: (value: string) => value,
}));

jest.mock("@/api/bwchat", () => ({
  getAgent: (...args: unknown[]) => mockGetAgent(...args),
}));

jest.mock("@/components/AuthenticatedImage", () => {
  const { View: MockView } = jest.requireActual("react-native");
  return { AuthenticatedImage: (props: object) => <MockView {...props} /> };
});

jest.mock("@/providers/AuthProvider", () => ({
  useAuth: () => ({ user: mockOwner }),
}));

jest.mock("@/services/agents/AgentCatalogRepository", () => ({
  invalidateAgentCatalog: (...args: unknown[]) => mockInvalidateCatalog(...args),
}));

jest.mock("@/services/agents/AgentEditNavigationStore", () => ({
  clearPendingAgentForEditing: (...args: unknown[]) => mockClearPending(...args),
  notifyAgentUpdated: (...args: unknown[]) => mockNotifyUpdated(...args),
  pendingAgentForEditing: () => null,
}));

jest.mock("@/services/agents/AgentCreatorTransaction", () => ({
  executeAgentCreatorTransaction: (...args: unknown[]) => mockExecuteTransaction(...args),
}));

jest.mock("@/services/agents/agentCreatorPolicy", () => {
  const actual = jest.requireActual("@/services/agents/agentCreatorPolicy");
  return {
    ...actual,
    makeAgentReferencePreview: (...args: unknown[]) => mockMakePreview(...args),
    removeAgentCreatorTemporaryFile: (...args: unknown[]) => mockRemoveTemporaryFile(...args),
  };
});

describe("AgentCreator screen account and interaction parity", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOwner = user("owner-a");
    mockParams = {};
    mockUuid = 0;
    mockGetAgent.mockResolvedValue(agent("agent-a", "智能体 A"));
    mockLaunchImageLibrary.mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file:///picker.jpg", width: 1_200, height: 900 }],
    });
    mockMakePreview.mockResolvedValue("file:///agent-preview.jpg");
    mockExecuteTransaction.mockResolvedValue({
      installed: agent("installed-agent", "已安装智能体"),
      createdNewAgent: true,
    });
    mockInvalidateCatalog.mockResolvedValue(undefined);
  });

  afterEach(() => cleanup());

  it("remounts the complete account-owned form when the signed-in owner changes", async () => {
    const view = await render(<AgentCreatorScreen />);
    await fireEvent.changeText(screen.getByLabelText("智能体名称"), "旧账号草稿");
    expect(screen.getByDisplayValue("旧账号草稿")).toBeTruthy();

    mockOwner = user("owner-b");
    await act(async () => {
      view.rerender(<AgentCreatorScreen />);
      await Promise.resolve();
    });

    expect(screen.getByLabelText("智能体名称").props.value).toBe("");
    expect(screen.getByLabelText("开场白").props.value).toBe("你好");
  });

  it("cleans only generated previews when replacing an image and leaving the screen", async () => {
    mockMakePreview
      .mockResolvedValueOnce("file:///generated-preview-a.jpg")
      .mockResolvedValueOnce("file:///generated-preview-b.jpg");
    const view = await render(<AgentCreatorScreen />);

    await fireEvent.press(screen.getByLabelText("上传主参考图"));
    await waitFor(() => expect(mockMakePreview).toHaveBeenCalledTimes(1));
    expect(mockRemoveTemporaryFile).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByLabelText("上传主参考图"));
    await waitFor(() =>
      expect(mockRemoveTemporaryFile).toHaveBeenCalledWith("file:///generated-preview-a.jpg"),
    );

    await act(async () => {
      view.unmount();
      await Promise.resolve();
    });
    expect(mockRemoveTemporaryFile).toHaveBeenCalledWith("file:///generated-preview-b.jpg");
    expect(mockRemoveTemporaryFile).not.toHaveBeenCalledWith("file:///picker.jpg");
  });

  it("shows the picked image immediately while its JPEG preview is still being prepared", async () => {
    const preview = deferred<string>();
    mockMakePreview.mockReturnValueOnce(preview.promise);
    await render(<AgentCreatorScreen />);

    await fireEvent.press(screen.getByLabelText("上传主参考图"));
    await waitFor(() =>
      expect(
        screen.getByTestId("agent-creator-reference-image", { includeHiddenElements: true }).props
          .source,
      ).toEqual({ uri: "file:///picker.jpg" }),
    );
    expect(screen.getByText("正在处理图片…")).toBeTruthy();

    await act(async () => {
      preview.resolve("file:///agent-preview.jpg");
      await preview.promise;
    });

    await waitFor(() =>
      expect(
        screen.getByTestId("agent-creator-reference-image", { includeHiddenElements: true }).props
          .source,
      ).toEqual({ uri: "file:///agent-preview.jpg" }),
    );
    expect(screen.getByText("已选择主参考图")).toBeTruthy();
  });

  it("disposes a generated preview that returns after an account switch", async () => {
    const preview = deferred<string>();
    mockMakePreview.mockReturnValueOnce(preview.promise);
    const view = await render(<AgentCreatorScreen />);
    await fireEvent.press(screen.getByLabelText("上传主参考图"));
    await waitFor(() => expect(mockMakePreview).toHaveBeenCalledTimes(1));

    mockOwner = user("owner-b");
    await act(async () => {
      view.rerender(<AgentCreatorScreen />);
      await Promise.resolve();
    });
    await act(async () => {
      preview.resolve("file:///late-generated-preview.jpg");
      await preview.promise;
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockRemoveTemporaryFile).toHaveBeenCalledWith("file:///late-generated-preview.jpg");
    expect(screen.getByLabelText("智能体名称").props.value).toBe("");
  });

  it("locks same-frame create taps and navigates only after the full transaction", async () => {
    const transaction = deferred<{
      installed: AgentSummary;
      createdNewAgent: boolean;
    }>();
    mockExecuteTransaction.mockReturnValueOnce(transaction.promise);
    await render(<AgentCreatorScreen />);
    await fireEvent.changeText(screen.getByLabelText("智能体名称"), "新伙伴");
    await fireEvent.press(screen.getByLabelText("上传主参考图"));
    await waitFor(() =>
      expect(screen.getByLabelText("创建").props.accessibilityState.disabled).toBe(false),
    );

    const create = screen.getByLabelText("创建");
    await fireEvent.press(create);
    await fireEvent.press(create);
    expect(mockExecuteTransaction).toHaveBeenCalledTimes(1);
    expect(mockBack).not.toHaveBeenCalled();

    const installed = agent("installed-agent", "新伙伴");
    await act(async () => {
      transaction.resolve({ installed, createdNewAgent: true });
      await transaction.promise;
    });

    expect(mockInvalidateCatalog).toHaveBeenCalledWith("owner-a");
    expect(mockNotifyUpdated).toHaveBeenCalledWith(installed);
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it("ignores an old edit hydration result after owner replacement", async () => {
    mockParams = { agentId: "agent-a" };
    const oldHydration = deferred<AgentSummary>();
    const newHydration = deferred<AgentSummary>();
    mockGetAgent
      .mockReturnValueOnce(oldHydration.promise)
      .mockReturnValueOnce(newHydration.promise);
    const view = await render(<AgentCreatorScreen />);
    await waitFor(() => expect(mockGetAgent).toHaveBeenCalledWith("agent-a"));

    mockOwner = user("owner-b");
    await act(async () => {
      view.rerender(<AgentCreatorScreen />);
      await Promise.resolve();
    });
    await waitFor(() => expect(mockGetAgent).toHaveBeenCalledTimes(2));

    await act(async () => {
      oldHydration.resolve(agent("agent-a", "旧账号智能体"));
      await oldHydration.promise;
    });
    expect(screen.queryByDisplayValue("旧账号智能体")).toBeNull();

    await act(async () => {
      newHydration.resolve(agent("agent-a", "新账号智能体"));
      await newHydration.promise;
    });
    await waitFor(() => expect(screen.getByDisplayValue("新账号智能体")).toBeTruthy());
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

function agent(id: string, name: string): AgentSummary {
  return {
    id,
    revision: 1,
    profile: { name },
    primary_reference_asset_id: `${id}-reference`,
    avatar_asset_id: `${id}-avatar`,
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
