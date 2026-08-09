import { InteractionManager } from "react-native";

import { runAfterNavigationInteractions } from "@/services/navigation/NavigationWorkScheduler";

describe("navigation work scheduler", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("waits for pending interactions", () => {
    let release: (() => void) | undefined;
    jest.spyOn(InteractionManager, "runAfterInteractions").mockImplementation((work) => {
      release = typeof work === "function" ? work : () => void work?.gen();
      return {
        then: Promise.resolve().then.bind(Promise.resolve()),
        done: jest.fn(),
        cancel: jest.fn(),
      };
    });
    const work = jest.fn();

    runAfterNavigationInteractions(work);
    expect(InteractionManager.runAfterInteractions).toHaveBeenCalledTimes(1);
    expect(work).not.toHaveBeenCalled();

    release?.();
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("cancels work before it can mutate an unfocused screen", () => {
    const cancel = jest.fn();
    jest.spyOn(InteractionManager, "runAfterInteractions").mockReturnValue({
      then: Promise.resolve().then.bind(Promise.resolve()),
      done: jest.fn(),
      cancel,
    });
    const work = jest.fn();
    const dispose = runAfterNavigationInteractions(work);

    dispose();

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(work).not.toHaveBeenCalled();
  });
});
