import { act, render } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { LayoutAnimation, StyleSheet, Text } from "react-native";

import { ChatComposerPanelHost } from "@/components/messages/ChatComposerSurface";

jest.mock("expo-haptics", () => ({ selectionAsync: jest.fn(async () => undefined) }));
jest.mock("expo-linear-gradient", () => ({
  LinearGradient: ({ children }: { children?: ReactNode }) => children ?? null,
}));
jest.mock("expo-symbols", () => ({ SymbolView: () => null }));

type Panel = "stickers" | "plus" | null;

function host(panel: Panel, keyboardInset = 0, isKeyboardFocused = false) {
  return (
    <ChatComposerPanelHost
      isKeyboardFocused={isKeyboardFocused}
      keyboardEquivalentInset={346}
      keyboardInset={keyboardInset}
      panel={panel}
      plusItemCount={6}
      plusPanel={<Text>plus-panel</Text>}
      restingInset={41}
      stickerPanel={<Text>sticker-panel</Text>}
    />
  );
}

describe("chat composer panel host", () => {
  let completions: (() => void)[];

  beforeEach(() => {
    completions = [];
    jest.spyOn(LayoutAnimation, "configureNext").mockImplementation((_config, onEnd) => {
      if (onEnd) completions.push(onEnd);
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("keeps the outgoing panel mounted until the native close transaction finishes", async () => {
    const view = await render(host("stickers"));
    expect(view.getByText("sticker-panel")).toBeTruthy();

    await view.rerender(host(null));

    expect(view.getByText("sticker-panel", { includeHiddenElements: true })).toBeTruthy();
    expect(
      view.getByTestId("chat-composer-panel-host", { includeHiddenElements: true }).props
        .pointerEvents,
    ).toBe("none");
    expect(
      StyleSheet.flatten(
        view.getByTestId("chat-composer-panel-host", { includeHiddenElements: true }).props.style,
      ),
    ).toMatchObject({ height: 41 });
    expect(
      StyleSheet.flatten(
        view.getByTestId("chat-composer-panel-viewport", { includeHiddenElements: true }).props
          .style,
      ),
    ).toMatchObject({ height: 0, overflow: "hidden" });
    expect(LayoutAnimation.configureNext).toHaveBeenCalledWith(
      expect.objectContaining({
        duration: 220,
        update: expect.objectContaining({ duration: 220, type: LayoutAnimation.Types.easeOut }),
      }),
      expect.any(Function),
    );

    await act(async () => completions.at(-1)?.());
    expect(view.queryByText("sticker-panel", { includeHiddenElements: true })).toBeNull();
  });

  it("does not let a stale close completion remove a rapidly reopened panel", async () => {
    const view = await render(host("stickers"));
    await view.rerender(host(null));
    const finishOldClose = completions.at(-1);

    await view.rerender(host("plus"));
    await act(async () => finishOldClose?.());

    expect(view.getByText("plus-panel")).toBeTruthy();
    expect(
      StyleSheet.flatten(view.getByTestId("chat-composer-panel-viewport").props.style),
    ).toMatchObject({ height: 202 });
  });

  it("restores the full viewport when the same sticker panel rapidly reopens", async () => {
    const view = await render(host("stickers"));
    await view.rerender(host(null));
    const finishOldClose = completions.at(-1);

    await view.rerender(host("stickers"));
    await act(async () => finishOldClose?.());

    expect(view.getByText("sticker-panel")).toBeTruthy();
    expect(
      StyleSheet.flatten(view.getByTestId("chat-composer-panel-viewport").props.style),
    ).toMatchObject({ height: 346 });
  });

  it("uses the keyboard event commit directly in both directions", async () => {
    const view = await render(host(null, 346, true));
    expect(
      StyleSheet.flatten(
        view.getByTestId("chat-composer-panel-host", { includeHiddenElements: true }).props.style,
      ),
    ).toMatchObject({ height: 346 });
    expect(
      StyleSheet.flatten(
        view.getByTestId("chat-composer-panel-viewport", { includeHiddenElements: true }).props
          .style,
      ),
    ).toMatchObject({ height: 0 });

    await view.rerender(host(null, 0, false));

    expect(
      StyleSheet.flatten(
        view.getByTestId("chat-composer-panel-host", { includeHiddenElements: true }).props.style,
      ),
    ).toMatchObject({ height: 41 });
    expect(
      StyleSheet.flatten(
        view.getByTestId("chat-composer-panel-viewport", { includeHiddenElements: true }).props
          .style,
      ),
    ).toMatchObject({ height: 0 });
    expect(LayoutAnimation.configureNext).not.toHaveBeenCalled();
  });

  it("collapses an outgoing panel if a focused hardware keyboard sends no frame", async () => {
    const view = await render(host("stickers"));
    jest.useFakeTimers();

    await view.rerender(host(null, 0, true));
    expect(view.getByText("sticker-panel", { includeHiddenElements: true })).toBeTruthy();

    await act(async () => jest.advanceTimersByTime(350));

    expect(
      StyleSheet.flatten(
        view.getByTestId("chat-composer-panel-host", { includeHiddenElements: true }).props.style,
      ),
    ).toMatchObject({ height: 41 });
    expect(
      StyleSheet.flatten(
        view.getByTestId("chat-composer-panel-viewport", { includeHiddenElements: true }).props
          .style,
      ),
    ).toMatchObject({ height: 0 });
    expect(LayoutAnimation.configureNext).toHaveBeenCalledWith(
      expect.objectContaining({ duration: 220 }),
      expect.any(Function),
    );

    await act(async () => completions.at(-1)?.());
    expect(view.queryByText("sticker-panel", { includeHiddenElements: true })).toBeNull();
  });
});
