import { act, fireEvent, render } from "@testing-library/react-native";

import { ChatCallRecordBubble } from "@/components/messages/ChatCallRecordBubble";
import { ChatMessageDeliveryStatus } from "@/components/messages/ChatMessageDeliveryStatus";
import { ChatMoneyReceiptTip } from "@/components/messages/ChatMoneyViews";

jest.mock("@/components/messages/ChatReplyViews", () => ({
  useChatMessageActivationGuard: () => () => true,
}));
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
jest.mock("@/providers/LocalizationProvider", () => ({
  useLocalization: () => ({
    t: (key: string, ...args: (string | number)[]) =>
      ({
        "call.record.duration": `通话时长 ${args[0] ?? ""}`,
        "call.record.missed.self": "未接听",
        "chatMoney.receipt.acceptedByOther": `${args[0] ?? ""}已收款`,
        "common.retry": "重试",
        "common.uploading": "上传中",
      })[key] ?? key,
  }),
}));
jest.mock("@/services/messages/ChatMoneyRepository", () => ({
  hasViewerClaimedChatMoney: jest.fn(async () => false),
}));

describe("MessageBubble exact-state components", () => {
  it("renders native call bubble copy, direction tail and 20pt symbol", async () => {
    const mine = await render(
      <ChatCallRecordBubble
        isFromMe
        record={{ callType: "video", duration: "05:09", status: "completed" }}
      />,
    );
    expect(mine.getByText("通话时长 05:09")).toBeTruthy();
    expect(mine.getByText("video.fill", { includeHiddenElements: true })).toBeTruthy();
    expect(mine.getByLabelText("通话时长 05:09")).toBeTruthy();
    await mine.unmount();

    const other = await render(
      <ChatCallRecordBubble isFromMe={false} record={{ callType: "voice", status: "missed" }} />,
    );
    expect(other.getByText("未接听")).toBeTruthy();
    expect(other.getByText("phone.fill", { includeHiddenElements: true })).toBeTruthy();
    await other.unmount();
  });

  it("offers exact failed retry and sending-media status semantics", async () => {
    const retry = jest.fn();
    const failed = await render(
      <ChatMessageDeliveryStatus deliveryStatus="failed" messageType="text" onRetry={retry} />,
    );
    expect(failed.getByText("exclamationmark.circle.fill")).toBeTruthy();
    await act(async () => fireEvent.press(failed.getByLabelText("重试")));
    expect(retry).toHaveBeenCalledTimes(1);
    await failed.unmount();

    const sending = await render(
      <ChatMessageDeliveryStatus deliveryStatus="sending" messageType="image" onRetry={retry} />,
    );
    expect(sending.getByText("clock")).toBeTruthy();
    expect(sending.getByLabelText("上传中")).toBeTruthy();
    await sending.unmount();

    const text = await render(
      <ChatMessageDeliveryStatus deliveryStatus="sending" messageType="text" onRetry={retry} />,
    );
    expect(text.toJSON()).toBeNull();
    await text.unmount();
  });

  it("uses native filled receipt status symbols and stable identifiers", async () => {
    const accepted = await render(
      <ChatMoneyReceiptTip
        content={JSON.stringify({
          asset_id: "transfer-1",
          event_id: "event-accepted",
          event_type: "transfer_accepted",
          actor_id: "friend",
          actor_name: "Alice",
          sender_id: "me",
        })}
        viewerId="me"
      />,
    );
    expect(accepted.getByText("checkmark.circle.fill")).toBeTruthy();
    expect(accepted.getByTestId("chatMoney.receipt.event-accepted")).toBeTruthy();
    await accepted.unmount();

    const returned = await render(
      <ChatMoneyReceiptTip
        content={JSON.stringify({
          asset_id: "transfer-1",
          event_id: "event-returned",
          event_type: "transfer_returned",
          actor_id: "friend",
          sender_id: "me",
        })}
      />,
    );
    expect(returned.getByText("arrow.uturn.backward.circle.fill")).toBeTruthy();
    await returned.unmount();
  });
});
