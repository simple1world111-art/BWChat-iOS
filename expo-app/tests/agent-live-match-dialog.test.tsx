import { act, fireEvent, render } from "@testing-library/react-native";

import { AgentVideoRoleMatchDialog } from "@/components/agents/AgentVideoRoleMatchDialog";
import type { AgentLiveVideoMatchController } from "@/services/live/useAgentLiveVideoMatch";

jest.mock("expo-haptics", () => ({
  ImpactFeedbackStyle: { Soft: "soft" },
  impactAsync: jest.fn(async () => undefined),
}));
jest.mock("expo-image", () => {
  const { View: MockView } = jest.requireActual("react-native");
  return { Image: (props: object) => <MockView {...props} /> };
});
jest.mock("expo-linear-gradient", () => {
  const { View: MockView } = jest.requireActual("react-native");
  return {
    LinearGradient: ({ children, ...props }: { children: React.ReactNode }) => (
      <MockView {...props}>{children}</MockView>
    ),
  };
});
jest.mock("expo-symbols", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return { SymbolView: ({ name }: { name: string }) => <MockText>{name}</MockText> };
});

function controller(
  overrides: Partial<AgentLiveVideoMatchController> = {},
): AgentLiveVideoMatchController {
  return {
    status: { kind: "idle" },
    isActive: false,
    start: jest.fn(async () => undefined),
    cancel: jest.fn(),
    reset: jest.fn(),
    ...overrides,
  };
}

describe("agent video role match dialog", () => {
  it("preserves the native role editor and starts with trimmed role and source agent", async () => {
    const match = controller();
    const view = await render(
      <AgentVideoRoleMatchDialog
        controller={match}
        initialRole="  Detective  "
        onDismiss={jest.fn()}
        sourceAgentId="agent-1"
      />,
    );

    expect(view.getByText("我希望你能扮演")).toBeTruthy();
    expect(view.getByText("100金币/分钟")).toBeTruthy();
    await act(async () => fireEvent.press(view.getByLabelText("匹配，视频通话每分钟消耗100金币")));
    expect(match.start).toHaveBeenCalledWith("Detective", "agent-1");
  });

  it("shows native matching copy and keeps cancellation available", async () => {
    const match = controller({ status: { kind: "matching" }, isActive: true });
    const view = await render(
      <AgentVideoRoleMatchDialog
        controller={match}
        initialRole="Role"
        onDismiss={jest.fn()}
        sourceAgentId="agent-1"
      />,
    );

    expect(view.getByText("正在匹配")).toBeTruthy();
    expect(view.getByText("正在依次联系正在直播的用户")).toBeTruthy();
    await act(async () => fireEvent.press(view.getByLabelText("取消匹配")));
    expect(match.cancel).toHaveBeenCalledTimes(1);
  });

  it("supports unavailable retry and closes without leaving an operation behind", async () => {
    const match = controller({
      status: { kind: "unavailable", message: "暂时没有主播接听" },
    });
    const onDismiss = jest.fn();
    const view = await render(
      <AgentVideoRoleMatchDialog
        controller={match}
        initialRole="Role"
        onDismiss={onDismiss}
        sourceAgentId="agent-1"
      />,
    );

    expect(view.getByText("暂时没有主播接听")).toBeTruthy();
    await act(async () => fireEvent.press(view.getByLabelText("重新匹配")));
    expect(match.reset).toHaveBeenCalledTimes(1);
    await act(async () => fireEvent.press(view.getByLabelText("关闭")));
    expect(match.cancel).toHaveBeenCalledTimes(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
