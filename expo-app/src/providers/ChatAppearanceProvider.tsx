import type { ImagePickerAsset } from "expo-image-picker";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useAuth } from "@/providers/AuthProvider";
import {
  backgroundKey,
  cacheUploadedBackgroundImage,
  deleteChatBackground,
  effectiveBackground,
  exactBackground,
  getChatBackgrounds,
  removeCachedBackgroundImage,
  uploadChatBackground,
  type ChatBackground,
  type ChatBackgroundTargetType,
} from "@/services/chat-appearance/ChatAppearanceService";

interface ChatAppearanceContextValue {
  backgrounds: Record<string, ChatBackground>;
  isLoading: boolean;
  load(force?: boolean): Promise<void>;
  exact(targetType: ChatBackgroundTargetType, targetId: string): ChatBackground | null;
  effective(targetType: ChatBackgroundTargetType, targetId: string): ChatBackground | null;
  upload(
    targetType: ChatBackgroundTargetType,
    targetId: string,
    asset: ImagePickerAsset,
  ): Promise<void>;
  remove(targetType: ChatBackgroundTargetType, targetId: string): Promise<void>;
}

type BackgroundSnapshot = {
  ownerId: string;
  items: Record<string, ChatBackground>;
};

type ActiveLoad = {
  ownerId: string;
  revision: number;
  promise: Promise<void>;
};

const emptyBackgrounds: Record<string, ChatBackground> = {};
const ChatAppearanceContext = createContext<ChatAppearanceContextValue | null>(null);

export function ChatAppearanceProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const ownerId = user?.user_id ?? "";
  const [snapshot, setSnapshot] = useState<BackgroundSnapshot>({
    ownerId: "",
    items: emptyBackgrounds,
  });
  const snapshotRef = useRef(snapshot);
  const [loadingOwnerId, setLoadingOwnerId] = useState("");
  const ownerRef = useRef(ownerId);
  const mountedRef = useRef(true);
  const revisionRef = useRef(0);
  const didLoadOwner = useRef("");
  const activeLoadRef = useRef<ActiveLoad | null>(null);

  const commitSnapshot = useCallback((next: BackgroundSnapshot) => {
    if (!mountedRef.current) return;
    snapshotRef.current = next;
    setSnapshot(next);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      revisionRef.current += 1;
      didLoadOwner.current = "";
      activeLoadRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (ownerRef.current === ownerId) return;
    ownerRef.current = ownerId;
    revisionRef.current += 1;
    didLoadOwner.current = "";
    activeLoadRef.current = null;
    if (!ownerId) {
      void Promise.resolve().then(() => {
        if (!mountedRef.current || ownerRef.current !== "") return;
        commitSnapshot({ ownerId: "", items: emptyBackgrounds });
        setLoadingOwnerId("");
      });
    }
  }, [commitSnapshot, ownerId]);

  const load = useCallback(
    (force = false): Promise<void> => {
      if (!mountedRef.current || !ownerId || (!force && didLoadOwner.current === ownerId)) {
        return Promise.resolve();
      }
      const currentRevision = revisionRef.current;
      const active = activeLoadRef.current;
      if (active?.ownerId === ownerId && active.revision === currentRevision) {
        return active.promise;
      }

      const revision = ++revisionRef.current;
      const requestOwnerId = ownerId;
      setLoadingOwnerId(requestOwnerId);
      const promise = (async () => {
        try {
          const items = await getChatBackgrounds();
          if (
            !mountedRef.current ||
            ownerRef.current !== requestOwnerId ||
            revisionRef.current !== revision
          )
            return;
          const next = Object.fromEntries(
            items.map((item) => [backgroundKey(item.target_type, item.target_id), item]),
          );
          const previous =
            snapshotRef.current.ownerId === requestOwnerId
              ? snapshotRef.current.items
              : emptyBackgrounds;
          await removeChangedBackgroundCaches(previous, next);
          if (
            !mountedRef.current ||
            ownerRef.current !== requestOwnerId ||
            revisionRef.current !== revision
          )
            return;
          commitSnapshot({ ownerId: requestOwnerId, items: next });
          didLoadOwner.current = requestOwnerId;
        } catch {
          // The Swift store keeps the current background and allows a later retry.
        } finally {
          if (
            mountedRef.current &&
            ownerRef.current === requestOwnerId &&
            revisionRef.current === revision
          ) {
            setLoadingOwnerId("");
          }
        }
      })();
      activeLoadRef.current = { ownerId: requestOwnerId, revision, promise };
      void promise
        .finally(() => {
          if (activeLoadRef.current?.promise === promise) {
            activeLoadRef.current = null;
          }
        })
        .catch(() => undefined);
      return promise;
    },
    [commitSnapshot, ownerId],
  );

  useEffect(() => {
    if (!ownerId) return;
    void load().catch(() => undefined);
  }, [load, ownerId]);

  const upload = useCallback(
    async (targetType: ChatBackgroundTargetType, targetId: string, asset: ImagePickerAsset) => {
      if (!mountedRef.current || !ownerId) return;
      const operationOwnerId = ownerId;
      const revision = ++revisionRef.current;
      setLoadingOwnerId("");
      const uploaded = await uploadChatBackground(targetType, targetId, asset);
      if (
        !mountedRef.current ||
        ownerRef.current !== operationOwnerId ||
        revisionRef.current !== revision
      )
        return;

      const key = backgroundKey(targetType, targetId);
      const current =
        snapshotRef.current.ownerId === operationOwnerId
          ? snapshotRef.current.items
          : emptyBackgrounds;
      const previous = current[key];
      if (!uploaded.background) {
        if (previous) await removeCachedBackgroundImage(previous);
        if (
          !mountedRef.current ||
          ownerRef.current !== operationOwnerId ||
          revisionRef.current !== revision
        )
          return;
        await load(true);
        return;
      }

      if (previous) await removeCachedBackgroundImage(previous);
      if (
        !mountedRef.current ||
        ownerRef.current !== operationOwnerId ||
        revisionRef.current !== revision
      )
        return;
      await cacheUploadedBackgroundImage(uploaded.background, uploaded.preparedUri);
      if (
        !mountedRef.current ||
        ownerRef.current !== operationOwnerId ||
        revisionRef.current !== revision
      )
        return;
      commitSnapshot({
        ownerId: operationOwnerId,
        items: { ...current, [key]: uploaded.background },
      });
    },
    [commitSnapshot, load, ownerId],
  );

  const remove = useCallback(
    async (targetType: ChatBackgroundTargetType, targetId: string) => {
      if (!mountedRef.current || !ownerId) return;
      const operationOwnerId = ownerId;
      const revision = ++revisionRef.current;
      setLoadingOwnerId("");
      await deleteChatBackground(targetType, targetId);
      if (
        !mountedRef.current ||
        ownerRef.current !== operationOwnerId ||
        revisionRef.current !== revision
      )
        return;
      const key = backgroundKey(targetType, targetId);
      const current =
        snapshotRef.current.ownerId === operationOwnerId
          ? snapshotRef.current.items
          : emptyBackgrounds;
      const previous = current[key];
      if (previous) await removeCachedBackgroundImage(previous);
      if (
        !mountedRef.current ||
        ownerRef.current !== operationOwnerId ||
        revisionRef.current !== revision
      )
        return;
      const next = { ...current };
      delete next[key];
      commitSnapshot({ ownerId: operationOwnerId, items: next });
    },
    [commitSnapshot, ownerId],
  );

  const backgrounds = snapshot.ownerId === ownerId ? snapshot.items : emptyBackgrounds;
  const value = useMemo<ChatAppearanceContextValue>(
    () => ({
      backgrounds,
      isLoading: Boolean(ownerId) && loadingOwnerId === ownerId,
      load,
      exact: (targetType, targetId) => exactBackground(backgrounds, targetType, targetId),
      effective: (targetType, targetId) => effectiveBackground(backgrounds, targetType, targetId),
      upload,
      remove,
    }),
    [backgrounds, load, loadingOwnerId, ownerId, remove, upload],
  );
  return <ChatAppearanceContext.Provider value={value}>{children}</ChatAppearanceContext.Provider>;
}

export function useChatAppearance(): ChatAppearanceContextValue {
  const value = useContext(ChatAppearanceContext);
  if (!value) {
    throw new Error("useChatAppearance must be used inside ChatAppearanceProvider");
  }
  return value;
}

async function removeChangedBackgroundCaches(
  previous: Record<string, ChatBackground>,
  next: Record<string, ChatBackground>,
): Promise<void> {
  await Promise.all(
    Object.entries(previous).map(async ([key, background]) => {
      const replacement = next[key];
      if (!replacement || !sameBackgroundImage(background, replacement)) {
        await removeCachedBackgroundImage(background);
      }
    }),
  );
}

function sameBackgroundImage(left: ChatBackground, right: ChatBackground): boolean {
  return left.image_url === right.image_url && (left.updated_at ?? "") === (right.updated_at ?? "");
}
