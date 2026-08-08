import { LinearGradient } from "expo-linear-gradient";
import { router, Stack, useFocusEffect } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useRef, useState } from "react";
import {
  Platform,
  PlatformColor,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  acceptFriendRequest,
  getFriendList,
  getFriendRequests,
  rejectFriendRequest,
} from "@/api/bwchat";
import { trimFoundationWhitespacesAndNewlines } from "@/api/normalizers";
import { Avatar } from "@/components/Avatar";
import { TopToast } from "@/components/TopToast";
import type { FriendRequest } from "@/models";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import {
  loadCachedFriendRequests,
  loadFriendRequestsWithNativeCache,
  loadFriendsWithNativeCache,
  markFriendRequestResolved,
} from "@/services/friends/FriendRepository";
import {
  acquireFriendRequestOperation,
  friendRequestsMetrics,
  releaseFriendRequestOperation,
  withoutFriendRequest,
  withoutResolvedFriendRequests,
} from "@/services/friends/FriendRequestsPolicy";
import { colors } from "@/theme";

const secondarySystemBackground =
  Platform.OS === "ios" ? PlatformColor("secondarySystemBackgroundColor") : colors.background;

export default function FriendRequestsScreen() {
  const { user } = useAuth();
  const { t } = useLocalization();
  const [requests, setRequests] = useState<FriendRequest[]>([]);
  const [updatingIds, setUpdatingIds] = useState<Set<number>>(() => new Set());
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const requestsRef = useRef<FriendRequest[]>([]);
  const updatingIdsRef = useRef<Set<number>>(new Set());
  const resolvedRequestIdsRef = useRef<Set<number>>(new Set());
  const focusGenerationRef = useRef(0);
  const displayedOwnerRef = useRef<string | null>(null);
  const dismissToast = useCallback(() => setToastMessage(null), []);

  const replaceRequests = useCallback((next: FriendRequest[]) => {
    requestsRef.current = next;
    setRequests(next);
  }, []);

  const replaceUpdatingIds = useCallback(() => {
    setUpdatingIds(new Set(updatingIdsRef.current));
  }, []);

  useFocusEffect(
    useCallback(() => {
      const ownerId = trimFoundationWhitespacesAndNewlines(user?.user_id ?? "");
      const generation = focusGenerationRef.current + 1;
      focusGenerationRef.current = generation;
      let active = true;

      if (displayedOwnerRef.current !== ownerId) {
        displayedOwnerRef.current = ownerId || null;
        resolvedRequestIdsRef.current = new Set();
        updatingIdsRef.current = new Set();
        replaceUpdatingIds();
        replaceRequests([]);
        setToastMessage(null);
      }

      if (ownerId) {
        void (async () => {
          const cached = await loadCachedFriendRequests(ownerId);
          if (
            !active ||
            generation !== focusGenerationRef.current ||
            displayedOwnerRef.current !== ownerId
          ) {
            return;
          }
          replaceRequests(withoutResolvedFriendRequests(cached, resolvedRequestIdsRef.current));

          try {
            const loaded = await loadFriendRequestsWithNativeCache(ownerId, getFriendRequests);
            if (
              active &&
              generation === focusGenerationRef.current &&
              displayedOwnerRef.current === ownerId
            ) {
              replaceRequests(withoutResolvedFriendRequests(loaded, resolvedRequestIdsRef.current));
            }
          } catch {
            // Native keeps the already seeded account cache and exposes no load error UI.
          }
        })();
      }

      return () => {
        active = false;
        if (focusGenerationRef.current === generation) {
          focusGenerationRef.current += 1;
        }
      };
    }, [replaceRequests, replaceUpdatingIds, user?.user_id]),
  );

  const perform = async (request: FriendRequest, action: "accept" | "reject") => {
    const ownerId = trimFoundationWhitespacesAndNewlines(user?.user_id ?? "");
    const generation = focusGenerationRef.current;
    const operationSet = updatingIdsRef.current;
    if (
      !ownerId ||
      displayedOwnerRef.current !== ownerId ||
      !acquireFriendRequestOperation(operationSet, request.request_id)
    ) {
      return;
    }
    replaceUpdatingIds();
    try {
      if (action === "accept") await acceptFriendRequest(request.request_id);
      else await rejectFriendRequest(request.request_id);

      void markFriendRequestResolved(ownerId, request.request_id).catch(() => undefined);
      const isCurrentOperation =
        generation === focusGenerationRef.current && displayedOwnerRef.current === ownerId;
      if (isCurrentOperation) {
        resolvedRequestIdsRef.current.add(request.request_id);
        replaceRequests(withoutFriendRequest(requestsRef.current, request.request_id));
      }
      if (action === "accept") {
        if (isCurrentOperation) {
          setToastMessage(t("friends.added", request.nickname));
        }
        try {
          await loadFriendsWithNativeCache(ownerId, getFriendList);
        } catch {
          // The accepted request remains authoritative; the list refreshes again on focus.
        }
      }
    } catch {
      // Native stores an internal operation error, but this view only renders the success toast.
    } finally {
      releaseFriendRequestOperation(operationSet, request.request_id);
      if (displayedOwnerRef.current === ownerId && updatingIdsRef.current === operationSet) {
        replaceUpdatingIds();
      }
    }
  };

  return (
    <View style={[styles.screen, { backgroundColor: secondarySystemBackground }]}>
      <Stack.Screen
        options={{
          title: t("contacts.friendRequests"),
          headerBackVisible: false,
          headerLeft: () => (
            <Pressable
              accessibilityLabel={t("common.back")}
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => router.back()}
              style={({ pressed }) => [styles.backButton, pressed && styles.pressedAction]}
              testID="friend-requests-back"
            >
              <SymbolView
                name="chevron.left"
                size={friendRequestsMetrics.backSymbolSize}
                weight="semibold"
                tintColor={colors.text}
              />
            </Pressable>
          ),
          headerShadowVisible: false,
          headerStyle: { backgroundColor: secondarySystemBackground },
          headerTintColor: colors.text,
          headerTitleAlign: "center",
        }}
      />
      {requests.length === 0 ? (
        <View style={styles.emptyState}>
          <SymbolView
            name="person.crop.circle.badge.clock"
            size={friendRequestsMetrics.emptyIconSize}
            tintColor={colors.tertiaryText}
          />
          <Text style={[styles.emptyText, { color: colors.secondaryText }]}>
            {t("friendRequests.empty")}
          </Text>
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false}>
          {requests.map((request) => (
            <View key={request.request_id}>
              <View style={styles.row}>
                <Avatar
                  uri={request.avatar_url}
                  name={request.nickname}
                  size={friendRequestsMetrics.avatarSize}
                />
                <View style={styles.rowBody}>
                  <Text numberOfLines={1} style={[styles.name, { color: colors.text }]}>
                    {request.nickname}
                  </Text>
                  <Text style={[styles.subtitle, { color: colors.secondaryText }]}>
                    {t("friendRequests.row.subtitle")}
                  </Text>
                </View>
                <View style={styles.rowSpacer} />
                <View style={styles.actions}>
                  <Pressable
                    accessibilityHint={request.nickname}
                    accessibilityLabel={t("common.cancel")}
                    accessibilityRole="button"
                    accessibilityState={{
                      busy: updatingIds.has(request.request_id),
                      disabled: updatingIds.has(request.request_id),
                    }}
                    disabled={updatingIds.has(request.request_id)}
                    onPress={() => void perform(request, "reject")}
                    style={({ pressed }) => [
                      styles.rejectButton,
                      { backgroundColor: colors.separator },
                      pressed && styles.pressedAction,
                    ]}
                    testID={`friend-request-reject-${request.request_id}`}
                  >
                    <SymbolView
                      name="xmark"
                      size={friendRequestsMetrics.actionSymbolSize}
                      weight="semibold"
                      tintColor={colors.secondaryText}
                    />
                  </Pressable>
                  <Pressable
                    accessibilityHint={request.nickname}
                    accessibilityLabel={t("common.confirm")}
                    accessibilityRole="button"
                    accessibilityState={{
                      busy: updatingIds.has(request.request_id),
                      disabled: updatingIds.has(request.request_id),
                    }}
                    disabled={updatingIds.has(request.request_id)}
                    onPress={() => void perform(request, "accept")}
                    style={({ pressed }) => [styles.acceptHitArea, pressed && styles.pressedAction]}
                    testID={`friend-request-accept-${request.request_id}`}
                  >
                    <LinearGradient
                      colors={[colors.accent, colors.accentDark]}
                      end={{ x: 1, y: 1 }}
                      start={{ x: 0, y: 0 }}
                      style={styles.acceptButton}
                    >
                      <SymbolView
                        name="checkmark"
                        size={friendRequestsMetrics.actionSymbolSize}
                        weight="semibold"
                        tintColor={colors.white}
                      />
                    </LinearGradient>
                  </Pressable>
                </View>
              </View>
              <View style={[styles.divider, { backgroundColor: colors.separator }]} />
            </View>
          ))}
        </ScrollView>
      )}
      <TopToast
        duration={friendRequestsMetrics.toastMilliseconds}
        message={toastMessage}
        onDismiss={dismissToast}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  backButton: {
    width: friendRequestsMetrics.backButtonSize,
    height: friendRequestsMetrics.backButtonSize,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    rowGap: friendRequestsMetrics.emptyGap,
  },
  emptyText: { fontSize: friendRequestsMetrics.emptyTextSize },
  row: {
    minHeight: friendRequestsMetrics.rowResolvedHeight,
    paddingHorizontal: friendRequestsMetrics.rowHorizontalInset,
    paddingVertical: friendRequestsMetrics.rowVerticalInset,
    flexDirection: "row",
    alignItems: "center",
    columnGap: friendRequestsMetrics.rowGap,
  },
  rowBody: { flexShrink: 1, minWidth: 0, rowGap: friendRequestsMetrics.copyGap },
  rowSpacer: { flex: 1, minWidth: friendRequestsMetrics.rowSpacerMinWidth },
  name: { fontSize: friendRequestsMetrics.nameSize, fontWeight: "600" },
  subtitle: { fontSize: friendRequestsMetrics.subtitleSize },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    columnGap: friendRequestsMetrics.actionsGap,
  },
  rejectButton: {
    width: friendRequestsMetrics.actionSize,
    height: friendRequestsMetrics.actionSize,
    borderRadius: friendRequestsMetrics.actionRadius,
    alignItems: "center",
    justifyContent: "center",
  },
  acceptHitArea: {
    width: friendRequestsMetrics.actionSize,
    height: friendRequestsMetrics.actionSize,
    borderRadius: friendRequestsMetrics.actionRadius,
  },
  pressedAction: { opacity: 0.72 },
  acceptButton: {
    width: friendRequestsMetrics.actionSize,
    height: friendRequestsMetrics.actionSize,
    borderRadius: friendRequestsMetrics.actionRadius,
    alignItems: "center",
    justifyContent: "center",
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: friendRequestsMetrics.dividerLeadingInset,
  },
});
