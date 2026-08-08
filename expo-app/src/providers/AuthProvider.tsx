import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import * as api from "@/api/bwchat";
import { APIError, subscribeAuthSessionEvents } from "@/api/client";
import type { AuthSession, User } from "@/models";
import { captureException } from "@/services/monitoring/MonitoringService";
import { loginLocationRecorder } from "@/services/location/MapLocationService";
import { cacheUser } from "@/services/cache/UserInfoCache";
import { shouldInvalidateCachedSession, splashMetrics } from "@/services/auth/splashPolicy";
import { clearCachedUser, readCachedUser, saveCachedUser } from "@/storage/authStorage";
import { clearTokens, readAccessToken, saveTokens } from "@/storage/tokenStorage";
import {
  authVisualAcceptanceEnabled,
  visualAcceptanceEnabled,
  visualAcceptanceUser,
} from "@/services/visualAcceptance";

interface AuthContextValue {
  user: User | null;
  isBootstrapping: boolean;
  isSessionUnverified: boolean;
  signIn(username: string, password: string): Promise<boolean>;
  signUp(username: string, password: string, nickname: string): Promise<boolean>;
  signOut(): Promise<void>;
  updateUser(user: User): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(() =>
    visualAcceptanceEnabled && !authVisualAcceptanceEnabled ? visualAcceptanceUser : null,
  );
  const [isBootstrapping, setIsBootstrapping] = useState(!visualAcceptanceEnabled);
  const [isSessionUnverified, setSessionUnverified] = useState(false);
  const authenticatedUserIdRef = useRef<string | null>(user?.user_id?.trim() || null);
  const authGenerationRef = useRef(0);
  const manualAuthOperationsRef = useRef(0);
  const authCommitTailRef = useRef<Promise<void>>(Promise.resolve());

  const enqueueAuthCommit = useCallback((operation: () => Promise<boolean>): Promise<boolean> => {
    const result = authCommitTailRef.current.catch(() => undefined).then(operation);
    authCommitTailRef.current = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }, []);

  useEffect(() => {
    authenticatedUserIdRef.current = user?.user_id?.trim() || null;
  }, [user?.user_id]);

  useEffect(
    () =>
      subscribeAuthSessionEvents((event) => {
        if (event.type === "refreshed") {
          if (manualAuthOperationsRef.current > 0) return;
          authenticatedUserIdRef.current = event.user.user_id.trim() || null;
          setUser(event.user);
          return;
        }
        authGenerationRef.current += 1;
        authenticatedUserIdRef.current = null;
        setSessionUnverified(false);
        setUser(null);
        void clearAuthPersistenceBestEffort("refresh_rejected_clear");
      }),
    [],
  );

  useEffect(() => {
    if (visualAcceptanceEnabled) return;
    let active = true;
    const generation = authGenerationRef.current;
    const isCurrent = () => active && generation === authGenerationRef.current;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      try {
        const [token, cachedUser] = await Promise.all([readAccessToken(), readCachedUser()]);
        if (!isCurrent()) return;
        if (!token) {
          await delay(splashMetrics.missingTokenDelayMilliseconds);
          if (isCurrent()) setIsBootstrapping(false);
          return;
        }

        if (cachedUser?.user_id) {
          setUser(cachedUser);
          setIsBootstrapping(false);
        } else {
          watchdog = setTimeout(() => {
            if (isCurrent()) setIsBootstrapping(false);
          }, splashMetrics.validationWatchdogMilliseconds);
        }

        try {
          const verified = await api.verifySession();
          if (!isCurrent()) return;
          setUser(verified.user);
          setSessionUnverified(false);
          await persistUserBestEffort(verified.user, "verify_session_user");
        } catch (verificationError) {
          if (!isCurrent()) return;
          try {
            const refreshed = await api.refreshSession();
            if (!isCurrent()) return;
            await saveTokens({
              accessToken: refreshed.token,
              refreshToken: refreshed.refresh_token,
            });
            await persistUserBestEffort(refreshed.user, "refresh_session_user");
            if (!isCurrent()) return;
            setUser(refreshed.user);
            setSessionUnverified(false);
          } catch (refreshError) {
            if (!isCurrent()) return;
            if (shouldInvalidateCachedSession(refreshError)) {
              await clearAuthPersistenceBestEffort("restore_session_clear");
              if (isCurrent()) {
                setUser(null);
                setSessionUnverified(false);
              }
            } else if (cachedUser?.user_id) {
              setUser(cachedUser);
              setSessionUnverified(true);
            } else {
              setUser(null);
            }
            captureException(refreshError, {
              operation: "restore_session",
              verifyFailure: readableErrorName(verificationError),
            });
          }
        }
      } catch (error) {
        captureException(error, { operation: "restore_session_storage" });
      } finally {
        if (watchdog) clearTimeout(watchdog);
        if (isCurrent()) setIsBootstrapping(false);
      }
    })();
    return () => {
      active = false;
      if (watchdog) clearTimeout(watchdog);
    };
  }, []);

  const applyLogin = useCallback(
    (session: AuthSession, generation: number) =>
      enqueueAuthCommit(async () => {
        if (generation !== authGenerationRef.current) return false;
        await saveTokens({ accessToken: session.token, refreshToken: session.refresh_token });
        if (generation !== authGenerationRef.current) {
          await clearAuthPersistenceBestEffort("superseded_login_tokens");
          return false;
        }
        await persistUserBestEffort(session.user, "login_user");
        if (generation !== authGenerationRef.current) {
          await clearAuthPersistenceBestEffort("superseded_login_user");
          return false;
        }
        const ownerId = session.user.user_id.trim();
        authenticatedUserIdRef.current = ownerId;
        setIsBootstrapping(false);
        setSessionUnverified(false);
        setUser(session.user);
        void loginLocationRecorder
          .recordAfterLogin(ownerId, (candidate) => authenticatedUserIdRef.current === candidate)
          .catch((error) => captureException(error, { operation: "login_location_record" }));
        return true;
      }),
    [enqueueAuthCommit],
  );

  const signIn = useCallback(
    async (username: string, password: string) => {
      const generation = ++authGenerationRef.current;
      manualAuthOperationsRef.current += 1;
      try {
        const session = await api.login(username, password);
        if (generation !== authGenerationRef.current) return false;
        return await applyLogin(session, generation);
      } finally {
        manualAuthOperationsRef.current -= 1;
      }
    },
    [applyLogin],
  );

  const signUp = useCallback(
    async (username: string, password: string, nickname: string) => {
      const generation = ++authGenerationRef.current;
      manualAuthOperationsRef.current += 1;
      try {
        const session = await api.register(username, password, nickname);
        if (generation !== authGenerationRef.current) return false;
        return await applyLogin(session, generation);
      } finally {
        manualAuthOperationsRef.current -= 1;
      }
    },
    [applyLogin],
  );

  const signOut = useCallback(async () => {
    const generation = ++authGenerationRef.current;
    manualAuthOperationsRef.current += 1;
    authenticatedUserIdRef.current = null;
    try {
      await api.logout();
    } catch (error) {
      captureException(error, { operation: "logout" });
    } finally {
      // Match AuthManager.logout(): a normal logout clears credentials and the
      // current identity, but keeps account-scoped offline caches for the next
      // login. Explicit cache controls remain responsible for deleting data.
      await enqueueAuthCommit(async () => {
        if (generation !== authGenerationRef.current) return false;
        setIsBootstrapping(false);
        setSessionUnverified(false);
        setUser(null);
        await clearAuthPersistenceBestEffort("logout_storage");
        return true;
      });
      manualAuthOperationsRef.current -= 1;
    }
  }, [enqueueAuthCommit]);

  const updateUser = useCallback(async (nextUser: User) => {
    authenticatedUserIdRef.current = nextUser.user_id.trim() || null;
    setUser(nextUser);
    await persistUserBestEffort(nextUser, "update_user");
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, isBootstrapping, isSessionUnverified, signIn, signUp, signOut, updateUser }),
    [isBootstrapping, isSessionUnverified, signIn, signOut, signUp, updateUser, user],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}

async function persistUserBestEffort(user: User, operation: string): Promise<void> {
  const results = await Promise.allSettled([saveCachedUser(user), cacheUser(user)]);
  reportRejectedPersistence(results, operation);
}

async function clearAuthPersistenceBestEffort(operation: string): Promise<void> {
  const results = await Promise.allSettled([clearTokens(), clearCachedUser()]);
  reportRejectedPersistence(results, operation);
}

function reportRejectedPersistence(
  results: PromiseSettledResult<unknown>[],
  operation: string,
): void {
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      captureException(result.reason, { operation, persistence_index: String(index) });
    }
  });
}

function readableErrorName(error: unknown): string {
  return error instanceof APIError
    ? `api-${error.status}`
    : error instanceof Error
      ? error.name
      : "unknown";
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
