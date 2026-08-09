import { useEffect, useState } from "react";
import { InteractionManager } from "react-native";

// Native-stack transitions run mostly on the UI thread and are not guaranteed
// to register as InteractionManager work. Keep destination cache reads, network
// requests and state-heavy mounts outside the default iOS push animation too.
export const NAVIGATION_TRANSITION_GUARD_MS = 420;

/**
 * Runs work only after both JS interactions and the native-stack transition
 * guard have settled. The two waits happen in parallel, so an interaction that
 * already lasts longer than the guard does not incur an additional delay.
 */
export function runAfterNavigationInteractions(work: () => void): () => void {
  let active = true;
  let interactionsSettled = false;
  let transitionGuardSettled = false;

  const runIfSettled = () => {
    if (!active || !interactionsSettled || !transitionGuardSettled) return;
    active = false;
    work();
  };

  const interactionTask = InteractionManager.runAfterInteractions(() => {
    interactionsSettled = true;
    runIfSettled();
  });
  const transitionGuard = setTimeout(() => {
    transitionGuardSettled = true;
    runIfSettled();
  }, NAVIGATION_TRANSITION_GUARD_MS);

  return () => {
    active = false;
    interactionTask.cancel();
    clearTimeout(transitionGuard);
  };
}

export function useNavigationInteractionsSettled(): boolean {
  const [settled, setSettled] = useState(false);

  useEffect(() => runAfterNavigationInteractions(() => setSettled(true)), []);

  return settled;
}
