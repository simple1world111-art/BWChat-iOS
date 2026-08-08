import type { ShortDramaSeries } from "@/models";

export type ShortDramaLibraryEvent =
  | { kind: "upsert"; owner_id: string; series: ShortDramaSeries }
  | { kind: "refresh"; owner_id: string; series_id?: string | undefined };

type Listener = (event: ShortDramaLibraryEvent) => void;

const listeners = new Set<Listener>();

export function publishShortDramaLibraryEvent(event: ShortDramaLibraryEvent): void {
  for (const listener of listeners) listener(event);
}

export function subscribeShortDramaLibrary(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
