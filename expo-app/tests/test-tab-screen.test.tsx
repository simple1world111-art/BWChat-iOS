import { fireEvent, render } from "@testing-library/react-native";

import TestScreen from "@/app/(tabs)/test";

const mockPush = jest.fn();

jest.mock("expo-router", () => ({
  router: { push: (...args: unknown[]) => mockPush(...args) },
}));
jest.mock("expo-symbols", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return { SymbolView: ({ name }: { name: string }) => <MockText>{String(name)}</MockText> };
});
jest.mock("@/components/RootTabTitle", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return { RootTabTitle: () => <MockText>测试</MockText> };
});
jest.mock("@/providers/LocalizationProvider", () => ({
  useLocalization: () => ({
    t: (key: string) =>
      ({
        "test.card.title": "测试卡片",
        "test.card.subtitle": "点击进入并验证 Preview 热更新",
      })[key] ?? key,
  }),
}));

describe("Test tab card entry", () => {
  beforeEach(() => jest.clearAllMocks());

  it("renders the test card and opens its destination", async () => {
    const view = await render(<TestScreen />);

    expect(view.getByText("测试卡片")).toBeTruthy();
    expect(view.getByText("点击进入并验证 Preview 热更新")).toBeTruthy();
    fireEvent.press(view.getByTestId("test-card-entry"));
    expect(mockPush).toHaveBeenCalledWith("/test-card");
  });
});
