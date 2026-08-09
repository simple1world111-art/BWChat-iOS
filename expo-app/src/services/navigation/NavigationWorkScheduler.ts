import { useEffect, useState } from "react";
import { InteractionManager } from "react-native";

/**
 * Keeps cache reads, requests and other state-heavy work out of an active
 * native-stack transition. Calling it from an effect means the destination
 * header has already committed before React starts the deferred work.
 */
export function runAfterNavigationInteractions(work: () => void): () => void {
  let active = true;
  const interactionTask = InteractionManager.runAfterInteractions(() => {
    if (active) work();
  });

  return () => {
    active = false;
    interactionTask.cancel();
  };
}

export function useNavigationInteractionsSettled(): boolean {
  const [settled, setSettled] = useState(false);

  useEffect(() => runAfterNavigationInteractions(() => setSettled(true)), []);

  return settled;
}
