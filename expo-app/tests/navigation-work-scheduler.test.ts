import { InteractionManager } from "react-native";

import {
  NAVIGATION_TRANSITION_GUARD_MS,
  runAfterNavigationInteractions,
} from "@/services/navigation/NavigationWorkScheduler";

describe("navigation work scheduler", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it("waits for both pending interactions and the native transition guard", () => {
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
    expect(work).not.toHaveBeenCalled();

    jest.advanceTimersByTime(NAVIGATION_TRANSITION_GUARD_MS - 1);
    expect(work).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("does not add a second delay when interactions outlast the transition guard", () => {
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
    jest.advanceTimersByTime(NAVIGATION_TRANSITION_GUARD_MS);
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
    jest.advanceTimersByTime(NAVIGATION_TRANSITION_GUARD_MS);

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(work).not.toHaveBeenCalled();
  });

  it("cancels work after interactions settle but before the transition guard ends", () => {
    jest.spyOn(InteractionManager, "runAfterInteractions").mockImplementation((work) => {
      if (typeof work === "function") work();
      else work?.gen();
      return {
        then: Promise.resolve().then.bind(Promise.resolve()),
        done: jest.fn(),
        cancel: jest.fn(),
      };
    });
    const work = jest.fn();
    const dispose = runAfterNavigationInteractions(work);

    dispose();
    jest.advanceTimersByTime(NAVIGATION_TRANSITION_GUARD_MS);

    expect(work).not.toHaveBeenCalled();
  });
});
