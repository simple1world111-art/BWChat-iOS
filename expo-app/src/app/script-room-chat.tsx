import { LinearGradient } from "expo-linear-gradient";
import { randomUUID } from "expo-crypto";
import { MenuView, type MenuAction } from "@expo/ui/community/menu";
import { router, Stack, useFocusEffect, useLocalSearchParams } from "expo-router";
import { SymbolView } from "expo-symbols";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useColorScheme,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import {
  endScriptRoom,
  getGroupMessages,
  getScriptRoom,
  markGroupMessagesRead,
  retryScriptTurn,
  submitScriptTurn,
} from "@/api/bwchat";
import { Avatar } from "@/components/Avatar";
import { AuthenticatedImage } from "@/components/AuthenticatedImage";
import { TopToast } from "@/components/TopToast";
import { chatComposerInputHeight } from "@/components/messages/ChatComposerInputHeight";
import { ChatKeyboardAvoidingView } from "@/components/messages/ChatKeyboardAvoidingView";
import { env } from "@/config/env";
import type { GroupMessage, ScriptRole, ScriptRoom, ScriptTurnState } from "@/models";
import { useAuth } from "@/providers/AuthProvider";
import { useLocalization } from "@/providers/LocalizationProvider";
import { markConversationRead } from "@/services/conversations/ConversationReadService";
import {
  applyConversationReadReceipt,
  clearConversationUnreadLocally,
} from "@/services/conversations/ConversationRepository";
import { chatRealtimeService } from "@/services/realtime/ChatRealtimeService";
import {
  clearPendingScriptRoomConversation,
  pendingScriptRoomConversation,
} from "@/services/scripts/ScriptRoomNavigationStore";
import {
  loadCachedScriptMessages,
  loadCachedScriptRoom,
  saveCachedScriptMessages,
  saveCachedScriptRoom,
} from "@/services/scripts/ScriptRoomRepository";
import {
  canSendScriptTurn,
  cappedScriptInput,
  isCompleteScriptRoom,
  isCurrentScriptPlayer,
  isScriptGenerating,
  mergeScriptMessages,
  provisionalScriptRoom,
  roleForScriptMessage,
  scriptMessageAvatar,
  scriptRoomMetrics,
  scriptText,
  scriptTurnContent,
} from "@/services/scripts/scriptRoomPolicy";
import { palette } from "@/theme";
import { resolveMediaUrl } from "@/utils/mediaUrl";

export default function ScriptRoomChatScreen() {
  const params = useLocalSearchParams<{ roomId?: string | string[] }>();
  const roomId = firstParam(params.roomId);
  const { user } = useAuth();
  const { selectedLanguage } = useLocalization();
  const ownerId = user?.user_id ?? "";
  const scheme = useColorScheme();
  const theme = palette(scheme);
  const styles = useMemo(() => makeStyles(scheme), [scheme]);
  const safeAreaInsets = useSafeAreaInsets();
  const initialRoom = useMemo(() => {
    const conversation = pendingScriptRoomConversation(roomId, ownerId);
    return conversation ? provisionalScriptRoom(conversation) : null;
  }, [ownerId, roomId]);
  const [room, setRoom] = useState<ScriptRoom | null>(initialRoom);
  const [messages, setMessages] = useState<GroupMessage[]>([]);
  const [turnState, setTurnState] = useState<ScriptTurnState | null>(null);
  const [inputText, setInputText] = useState("");
  const initialInputHeight = chatComposerInputHeight(inputText);
  const [isInputFocused, setInputFocused] = useState(false);
  const [isLoading, setLoading] = useState(!initialRoom);
  const [isSending, setSending] = useState(false);
  const [hasAuthoritativeRoom, setAuthoritativeRoom] = useState(isCompleteScriptRoom(initialRoom));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const roomRef = useRef(room);
  const messagesRef = useRef(messages);
  const sendingRef = useRef(false);
  const locallyPublishedMessageIdsRef = useRef(new Set<number>());
  const visibleRef = useRef(false);
  const activeOwnerRef = useRef(ownerId);
  const activeRoomIdRef = useRef(roomId);
  const sessionGenerationRef = useRef(0);
  const mountedSessionRef = useRef({ ownerId, roomId });
  const loadingOperationRef = useRef<{ key: string; promise: Promise<void> } | null>(null);
  const initialLoadCompleteRef = useRef(false);
  const listRef = useRef<FlatList<GroupMessage>>(null);
  const scrollOffsetRef = useRef(0);
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollAnimationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    roomRef.current = room;
  }, [room]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  useEffect(() => {
    activeOwnerRef.current = ownerId;
    activeRoomIdRef.current = roomId;
    const previous = mountedSessionRef.current;
    if (previous.ownerId === ownerId && previous.roomId === roomId) return;
    sessionGenerationRef.current += 1;
    const firstOwnerHydration = !previous.ownerId && Boolean(ownerId) && previous.roomId === roomId;
    const nextRoom = firstOwnerHydration
      ? roomRef.current
      : previous.roomId !== roomId
        ? initialRoom
        : null;
    mountedSessionRef.current = { ownerId, roomId };
    roomRef.current = nextRoom;
    messagesRef.current = [];
    locallyPublishedMessageIdsRef.current.clear();
    setRoom(nextRoom);
    setMessages([]);
    setTurnState(null);
    setInputText("");
    sendingRef.current = false;
    setSending(false);
    setLoading(!nextRoom);
    setAuthoritativeRoom(isCompleteScriptRoom(nextRoom));
    setErrorMessage(null);
    initialLoadCompleteRef.current = false;
    scrollOffsetRef.current = 0;
    if (scrollTimeoutRef.current !== null) clearTimeout(scrollTimeoutRef.current);
    if (scrollAnimationFrameRef.current !== null) {
      cancelAnimationFrame(scrollAnimationFrameRef.current);
    }
    scrollTimeoutRef.current = null;
    scrollAnimationFrameRef.current = null;
  }, [initialRoom, ownerId, roomId]);

  useEffect(() => () => clearPendingScriptRoomConversation(roomId, ownerId), [ownerId, roomId]);
  useEffect(
    () => () => {
      sessionGenerationRef.current += 1;
      if (scrollTimeoutRef.current !== null) clearTimeout(scrollTimeoutRef.current);
      if (scrollAnimationFrameRef.current !== null) {
        cancelAnimationFrame(scrollAnimationFrameRef.current);
      }
    },
    [],
  );

  const text = useCallback(
    (chinese: string, english: string) => scriptText(selectedLanguage, chinese, english),
    [selectedLanguage],
  );

  const persistMessages = useCallback(
    async (
      groupId: number,
      incoming: GroupMessage[],
      requestedOwner = ownerId,
      requestedRoomId = roomId,
      requestedGeneration = sessionGenerationRef.current,
    ) => {
      if (
        !isActiveSession(
          activeOwnerRef,
          activeRoomIdRef,
          sessionGenerationRef,
          requestedOwner,
          requestedRoomId,
          requestedGeneration,
        )
      )
        return;
      const merged = mergeScriptMessages(messagesRef.current, incoming, groupId);
      messagesRef.current = merged;
      setMessages(merged);
      try {
        await saveCachedScriptMessages(requestedOwner, groupId, merged);
      } catch {
        /* best effort */
      }
    },
    [ownerId, roomId],
  );

  const scrollToBottom = useCallback(
    (requestedOwner: string, requestedRoomId: string, requestedGeneration: number) => {
      if (
        !initialLoadCompleteRef.current ||
        !visibleRef.current ||
        !isActiveSession(
          activeOwnerRef,
          activeRoomIdRef,
          sessionGenerationRef,
          requestedOwner,
          requestedRoomId,
          requestedGeneration,
        )
      )
        return;
      if (scrollTimeoutRef.current !== null) clearTimeout(scrollTimeoutRef.current);
      scrollTimeoutRef.current = setTimeout(() => {
        scrollTimeoutRef.current = null;
        if (
          !visibleRef.current ||
          !isActiveSession(
            activeOwnerRef,
            activeRoomIdRef,
            sessionGenerationRef,
            requestedOwner,
            requestedRoomId,
            requestedGeneration,
          )
        )
          return;
        const startOffset = scrollOffsetRef.current;
        if (startOffset <= 0) {
          listRef.current?.scrollToOffset({ offset: 0, animated: false });
          return;
        }
        if (scrollAnimationFrameRef.current !== null) {
          cancelAnimationFrame(scrollAnimationFrameRef.current);
        }
        const startedAt = Date.now();
        const step = () => {
          const progress = Math.min(
            (Date.now() - startedAt) / scriptRoomMetrics.scrollAnimationMilliseconds,
            1,
          );
          const eased = 1 - (1 - progress) ** 2;
          const offset = startOffset * (1 - eased);
          scrollOffsetRef.current = offset;
          listRef.current?.scrollToOffset({ offset, animated: false });
          if (
            progress < 1 &&
            visibleRef.current &&
            isActiveSession(
              activeOwnerRef,
              activeRoomIdRef,
              sessionGenerationRef,
              requestedOwner,
              requestedRoomId,
              requestedGeneration,
            )
          ) {
            scrollAnimationFrameRef.current = requestAnimationFrame(step);
          } else {
            scrollAnimationFrameRef.current = null;
          }
        };
        scrollAnimationFrameRef.current = requestAnimationFrame(step);
      }, scriptRoomMetrics.scrollDelayMilliseconds);
    },
    [],
  );

  const syncMessages = useCallback(
    async (
      loadedRoom: ScriptRoom,
      requestedOwner: string,
      requestedRoomId: string,
      requestedGeneration: number,
    ) => {
      const cachedMessages = await loadCachedScriptMessages(
        requestedOwner,
        loadedRoom.group_id,
      ).catch(() => [] as GroupMessage[]);
      if (
        !isActiveSession(
          activeOwnerRef,
          activeRoomIdRef,
          sessionGenerationRef,
          requestedOwner,
          requestedRoomId,
          requestedGeneration,
        )
      )
        return;
      const seeded = mergeScriptMessages(messagesRef.current, cachedMessages, loadedRoom.group_id);
      messagesRef.current = seeded;
      setMessages(seeded);
      try {
        let latestId = seeded.at(-1)?.id ?? 0;
        if (latestId > 0) {
          let shouldContinue = true;
          while (shouldContinue) {
            const page = await getGroupMessages(loadedRoom.group_id, {
              afterId: latestId,
              limit: 100,
            });
            if (
              !isActiveSession(
                activeOwnerRef,
                activeRoomIdRef,
                sessionGenerationRef,
                requestedOwner,
                requestedRoomId,
                requestedGeneration,
              )
            )
              return;
            const scoped = page.messages.filter(
              (message) => message.group_id === loadedRoom.group_id,
            );
            const nextId: number = scoped.reduce(
              (maximum, message) => Math.max(maximum, message.id),
              latestId,
            );
            if (scoped.length > 0) {
              await persistMessages(
                loadedRoom.group_id,
                scoped,
                requestedOwner,
                requestedRoomId,
                requestedGeneration,
              );
            }
            shouldContinue = page.hasMore && nextId > latestId;
            latestId = nextId;
          }
        } else {
          const page = await getGroupMessages(loadedRoom.group_id, { limit: 100 });
          if (
            !isActiveSession(
              activeOwnerRef,
              activeRoomIdRef,
              sessionGenerationRef,
              requestedOwner,
              requestedRoomId,
              requestedGeneration,
            )
          )
            return;
          await persistMessages(
            loadedRoom.group_id,
            page.messages.filter((message) => message.group_id === loadedRoom.group_id),
            requestedOwner,
            requestedRoomId,
            requestedGeneration,
          );
        }
      } catch (error) {
        if (
          messagesRef.current.length === 0 &&
          isActiveSession(
            activeOwnerRef,
            activeRoomIdRef,
            sessionGenerationRef,
            requestedOwner,
            requestedRoomId,
            requestedGeneration,
          )
        ) {
          setErrorMessage(readableError(error));
        }
      }
    },
    [persistMessages],
  );

  const load = useCallback((): Promise<void> => {
    if (!roomId || !ownerId) return Promise.resolve();
    const requestedOwner = ownerId;
    const requestedRoomId = roomId;
    const requestedGeneration = sessionGenerationRef.current;
    const key = scriptRoomSessionKey(requestedOwner, requestedRoomId);
    const existing = loadingOperationRef.current;
    if (existing?.key === key) return existing.promise;
    let operation!: Promise<void>;
    operation = (async () => {
      setErrorMessage(null);
      if (!roomRef.current) setLoading(true);
      try {
        const cached = await loadCachedScriptRoom(requestedOwner, requestedRoomId).catch(
          () => null,
        );
        if (
          !isActiveSession(
            activeOwnerRef,
            activeRoomIdRef,
            sessionGenerationRef,
            requestedOwner,
            requestedRoomId,
            requestedGeneration,
          )
        )
          return;
        let resolvedRoom = roomRef.current;
        if (cached) {
          resolvedRoom = cached.value;
          roomRef.current = cached.value;
          setRoom(cached.value);
          setAuthoritativeRoom(true);
        }
        if (!cached || cached.isStale) {
          try {
            const remote = await getScriptRoom(requestedRoomId);
            if (
              !isActiveSession(
                activeOwnerRef,
                activeRoomIdRef,
                sessionGenerationRef,
                requestedOwner,
                requestedRoomId,
                requestedGeneration,
              )
            )
              return;
            resolvedRoom = remote;
            roomRef.current = remote;
            setRoom(remote);
            setAuthoritativeRoom(true);
            await saveCachedScriptRoom(requestedOwner, remote).catch(() => undefined);
          } catch (error) {
            if (
              !resolvedRoom &&
              isActiveSession(
                activeOwnerRef,
                activeRoomIdRef,
                sessionGenerationRef,
                requestedOwner,
                requestedRoomId,
                requestedGeneration,
              )
            ) {
              setErrorMessage(readableError(error));
              return;
            }
          }
        }
        if (resolvedRoom) {
          await syncMessages(resolvedRoom, requestedOwner, requestedRoomId, requestedGeneration);
        }
      } finally {
        if (
          isActiveSession(
            activeOwnerRef,
            activeRoomIdRef,
            sessionGenerationRef,
            requestedOwner,
            requestedRoomId,
            requestedGeneration,
          )
        ) {
          setLoading(false);
        }
        if (loadingOperationRef.current?.promise === operation) {
          loadingOperationRef.current = null;
        }
      }
    })();
    loadingOperationRef.current = { key, promise: operation };
    return operation;
  }, [ownerId, roomId, syncMessages]);

  useEffect(() => {
    const requestedGeneration = sessionGenerationRef.current;
    return chatRealtimeService.subscribe((event) => {
      if (
        !isActiveSession(
          activeOwnerRef,
          activeRoomIdRef,
          sessionGenerationRef,
          ownerId,
          roomId,
          requestedGeneration,
        )
      )
        return;
      const currentRoom = roomRef.current;
      if (
        event.type === "group_message" &&
        currentRoom &&
        event.message.group_id === currentRoom.group_id
      ) {
        if (locallyPublishedMessageIdsRef.current.delete(event.message.id)) return;
        void persistMessages(
          currentRoom.group_id,
          [event.message],
          ownerId,
          roomId,
          requestedGeneration,
        );
        if (visibleRef.current) {
          void markScriptRoomRead(ownerId, currentRoom.group_id, event.message.id);
        }
        scrollToBottom(ownerId, roomId, requestedGeneration);
      } else if (event.type === "script_turn_state" && event.state.room_id === roomId) {
        setTurnState(event.state);
        if (event.state.status === "failed") setErrorMessage(event.state.message ?? null);
        scrollToBottom(ownerId, roomId, requestedGeneration);
      }
    });
  }, [ownerId, persistMessages, roomId, scrollToBottom]);

  useFocusEffect(
    useCallback(() => {
      const requestedOwner = ownerId;
      const requestedRoomId = roomId;
      const requestedGeneration = sessionGenerationRef.current;
      visibleRef.current = true;
      initialLoadCompleteRef.current = false;
      void load().finally(() => {
        if (
          visibleRef.current &&
          isActiveSession(
            activeOwnerRef,
            activeRoomIdRef,
            sessionGenerationRef,
            requestedOwner,
            requestedRoomId,
            requestedGeneration,
          )
        ) {
          initialLoadCompleteRef.current = true;
        }
      });
      const currentRoom = roomRef.current;
      if (currentRoom && currentRoom.group_id > 0) {
        chatRealtimeService.setActiveConversation("group", String(currentRoom.group_id));
        void markScriptRoomRead(ownerId, currentRoom.group_id);
      }
      return () => {
        Keyboard.dismiss();
        visibleRef.current = false;
        initialLoadCompleteRef.current = false;
        const groupId = roomRef.current?.group_id;
        if (
          groupId !== undefined &&
          groupId > 0 &&
          chatRealtimeService.isConversationActive("group", String(groupId))
        ) {
          chatRealtimeService.setActiveConversation("group", null);
        }
      };
    }, [load, ownerId, roomId]),
  );

  const roomGroupId = room?.group_id;
  useEffect(() => {
    if (!visibleRef.current || roomGroupId === undefined || roomGroupId <= 0) return;
    chatRealtimeService.setActiveConversation("group", String(roomGroupId));
    void markScriptRoomRead(ownerId, roomGroupId);
  }, [ownerId, roomGroupId]);

  const generating = isScriptGenerating(turnState, isSending);
  const canSend = canSendScriptTurn({
    room,
    hasAuthoritativeRoom,
    isGenerating: generating,
    text: inputText,
  });

  const send = useCallback(async () => {
    const content = scriptTurnContent(inputText);
    if (!content || generating || sendingRef.current || roomRef.current?.status !== "active")
      return;
    const requestedOwner = ownerId;
    const requestedRoomId = roomId;
    const requestedGeneration = sessionGenerationRef.current;
    setInputText("");
    sendingRef.current = true;
    setSending(true);
    try {
      const response = await submitScriptTurn(requestedRoomId, content, randomUUID().toUpperCase());
      if (
        !isActiveSession(
          activeOwnerRef,
          activeRoomIdRef,
          sessionGenerationRef,
          requestedOwner,
          requestedRoomId,
          requestedGeneration,
        )
      )
        return;
      const incoming = [response.user_message, response.ai_message].filter(
        (message): message is GroupMessage => Boolean(message),
      );
      const groupId = roomRef.current?.group_id;
      if (groupId !== undefined && incoming.length > 0) {
        void persistMessages(
          groupId,
          incoming,
          requestedOwner,
          requestedRoomId,
          requestedGeneration,
        );
      }
      if (response.user_message) {
        locallyPublishedMessageIdsRef.current.add(response.user_message.id);
        if (!chatRealtimeService.publishLocalGroupMessage(requestedOwner, response.user_message)) {
          locallyPublishedMessageIdsRef.current.delete(response.user_message.id);
        }
      }
      setTurnState({
        room_id: requestedRoomId,
        turn_id: response.turn_id,
        status: response.status,
      });
      scrollToBottom(requestedOwner, requestedRoomId, requestedGeneration);
    } catch (error) {
      if (
        isActiveSession(
          activeOwnerRef,
          activeRoomIdRef,
          sessionGenerationRef,
          requestedOwner,
          requestedRoomId,
          requestedGeneration,
        )
      ) {
        setInputText(content);
        setErrorMessage(readableError(error));
      }
    } finally {
      if (
        isActiveSession(
          activeOwnerRef,
          activeRoomIdRef,
          sessionGenerationRef,
          requestedOwner,
          requestedRoomId,
          requestedGeneration,
        )
      ) {
        sendingRef.current = false;
        setSending(false);
      }
    }
  }, [generating, inputText, ownerId, persistMessages, roomId, scrollToBottom]);

  const retry = useCallback(async () => {
    if (turnState?.status !== "failed" || isSending || sendingRef.current) return;
    const requestedOwner = ownerId;
    const requestedRoomId = roomId;
    const requestedGeneration = sessionGenerationRef.current;
    const turnId = turnState.turn_id;
    sendingRef.current = true;
    setSending(true);
    try {
      const response = await retryScriptTurn(requestedRoomId, turnId);
      if (
        !isActiveSession(
          activeOwnerRef,
          activeRoomIdRef,
          sessionGenerationRef,
          requestedOwner,
          requestedRoomId,
          requestedGeneration,
        )
      )
        return;
      setTurnState({
        room_id: requestedRoomId,
        turn_id: response.turn_id,
        status: response.status,
      });
      const groupId = roomRef.current?.group_id;
      if (groupId !== undefined && response.ai_message) {
        void persistMessages(
          groupId,
          [response.ai_message],
          requestedOwner,
          requestedRoomId,
          requestedGeneration,
        );
      }
    } catch (error) {
      if (
        isActiveSession(
          activeOwnerRef,
          activeRoomIdRef,
          sessionGenerationRef,
          requestedOwner,
          requestedRoomId,
          requestedGeneration,
        )
      ) {
        setErrorMessage(readableError(error));
      }
    } finally {
      if (
        isActiveSession(
          activeOwnerRef,
          activeRoomIdRef,
          sessionGenerationRef,
          requestedOwner,
          requestedRoomId,
          requestedGeneration,
        )
      ) {
        sendingRef.current = false;
        setSending(false);
      }
    }
  }, [isSending, ownerId, persistMessages, roomId, turnState]);

  const finishRoom = useCallback(async () => {
    if (roomRef.current?.status !== "active") return;
    const requestedOwner = ownerId;
    const requestedRoomId = roomId;
    const requestedGeneration = sessionGenerationRef.current;
    try {
      await endScriptRoom(requestedRoomId);
      if (
        !isActiveSession(
          activeOwnerRef,
          activeRoomIdRef,
          sessionGenerationRef,
          requestedOwner,
          requestedRoomId,
          requestedGeneration,
        )
      )
        return;
      const current = roomRef.current;
      if (!current) return;
      const ended: ScriptRoom = { ...current, status: "ended" };
      roomRef.current = ended;
      setRoom(ended);
      await saveCachedScriptRoom(requestedOwner, ended).catch(() => undefined);
    } catch (error) {
      if (
        isActiveSession(
          activeOwnerRef,
          activeRoomIdRef,
          sessionGenerationRef,
          requestedOwner,
          requestedRoomId,
          requestedGeneration,
        )
      ) {
        setErrorMessage(readableError(error));
      }
    }
  }, [ownerId, roomId]);

  const requestEnd = useCallback(() => {
    if (!hasAuthoritativeRoom || roomRef.current?.status !== "active") return;
    Alert.alert(
      text("结束当前剧情？", "End this story?"),
      text(
        "结束后仍可查看历史消息，但不能继续发送。",
        "History remains readable, but no new turns can be sent.",
      ),
      [
        { text: text("取消", "Cancel"), style: "cancel" },
        {
          text: text("结束剧情", "End story"),
          style: "destructive",
          onPress: () => void finishRoom(),
        },
      ],
    );
  }, [finishRoom, hasAuthoritativeRoom, text]);

  const roomMenuActions = useMemo<MenuAction[]>(
    () =>
      hasAuthoritativeRoom && room?.status === "active"
        ? [
            {
              id: "end-story",
              title: text("结束剧情", "End story"),
              image: "stop.circle",
              attributes: { destructive: true },
            },
          ]
        : [],
    [hasAuthoritativeRoom, room?.status, text],
  );

  const orderedMessages = useMemo(() => [...messages].reverse(), [messages]);

  return (
    <ChatKeyboardAvoidingView style={styles.screen}>
      <Stack.Screen
        options={{
          title: room?.script_snapshot.title || text("剧本房间", "Script Room"),
          headerTitleAlign: "center",
          headerStyle: { backgroundColor: theme.card },
          headerLeft: () => (
            <Pressable
              accessibilityLabel={text("返回", "Back")}
              accessibilityRole="button"
              hitSlop={10}
              onPress={() => {
                Keyboard.dismiss();
                router.back();
              }}
            >
              <SymbolView name="chevron.left" size={17} weight="semibold" tintColor={theme.text} />
            </Pressable>
          ),
          headerRight: () => (
            <MenuView
              actions={roomMenuActions}
              onPressAction={(event) => {
                if (event.nativeEvent.event === "end-story") requestEnd();
              }}
              style={styles.menuHost}
            >
              <View
                accessible
                accessibilityLabel={text("更多", "More")}
                accessibilityRole="button"
                style={styles.menuTrigger}
              >
                <SymbolView name="ellipsis.circle" size={20} tintColor={theme.text} />
              </View>
            </MenuView>
          ),
        }}
      />

      {room ? (
        <>
          <RoleRoster room={room} onDismissKeyboard={Keyboard.dismiss} styles={styles} />
          <FlatList
            ref={listRef}
            contentContainerStyle={styles.timeline}
            data={orderedMessages}
            inverted
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            keyExtractor={(message) => String(message.id)}
            ListFooterComponent={<StoryHeader room={room} styles={styles} />}
            ListHeaderComponent={
              <TurnStateView
                generating={generating}
                onRetry={() => void retry()}
                room={room}
                styles={styles}
                text={text}
                turnState={turnState}
              />
            }
            onScrollBeginDrag={Keyboard.dismiss}
            onScroll={(event) => {
              scrollOffsetRef.current = event.nativeEvent.contentOffset.y;
            }}
            scrollEventThrottle={16}
            renderItem={({ item }) => {
              const role = roleForScriptMessage(item, room);
              return (
                <ScriptMessageRow
                  currentPlayer={isCurrentScriptPlayer(item, user?.user_id)}
                  message={item}
                  role={role}
                  styles={styles}
                />
              );
            }}
            showsVerticalScrollIndicator={false}
          />
        </>
      ) : isLoading ? (
        <View style={styles.centerState}>
          <ActivityIndicator color={theme.accent} />
        </View>
      ) : (
        <View style={styles.centerState}>
          <SymbolView
            name="bubble.left.and.exclamationmark.bubble.right"
            size={36}
            weight="semibold"
            tintColor={theme.accent}
          />
          <Text style={styles.emptyTitle}>{text("无法恢复房间", "Unable to restore room")}</Text>
          <Text style={styles.emptySubtitle}>
            {errorMessage ?? text("请稍后重试", "Please try again")}
          </Text>
        </View>
      )}

      <View
        style={[
          styles.composer,
          { paddingBottom: isInputFocused ? 12 : 12 + safeAreaInsets.bottom },
        ]}
      >
        <View style={styles.composerRow}>
          <TextInput
            accessibilityLabel={
              room?.status === "ended"
                ? text("剧情已结束", "Story ended")
                : text("以角色身份推进剧情…", "Continue in character…")
            }
            editable={hasAuthoritativeRoom && room?.status === "active" && !generating}
            multiline
            onBlur={() => setInputFocused(false)}
            onChangeText={(value) => setInputText(cappedScriptInput(value))}
            onFocus={() => setInputFocused(true)}
            onSubmitEditing={() => void send()}
            placeholder={
              room?.status === "ended"
                ? text("剧情已结束", "Story ended")
                : text("以角色身份推进剧情…", "Continue in character…")
            }
            placeholderTextColor={theme.tertiaryText}
            returnKeyType="send"
            style={[
              styles.input,
              initialInputHeight !== undefined && { height: initialInputHeight },
            ]}
            submitBehavior="submit"
            testID="script-room-input"
            value={inputText}
          />
          <Pressable
            accessibilityLabel={text("发送回合", "Send turn")}
            accessibilityRole="button"
            accessibilityState={{ disabled: !canSend }}
            disabled={!canSend}
            onPress={() => void send()}
            testID="script-room-send"
          >
            <LinearGradient
              colors={
                canSend
                  ? [theme.accent, theme.accentDark]
                  : [theme.tertiaryText, theme.tertiaryText]
              }
              end={{ x: 1, y: 1 }}
              start={{ x: 0, y: 0 }}
              style={styles.sendButton}
            >
              <SymbolView
                name="arrow.up"
                size={scriptRoomMetrics.sendIconSize}
                weight="bold"
                tintColor={theme.white}
              />
            </LinearGradient>
          </Pressable>
        </View>
      </View>
      <TopToast
        duration={scriptRoomMetrics.toastMilliseconds}
        message={errorMessage}
        onDismiss={() => setErrorMessage(null)}
      />
    </ChatKeyboardAvoidingView>
  );
}

function RoleRoster({
  room,
  onDismissKeyboard,
  styles,
}: {
  room: ScriptRoom;
  onDismissKeyboard: () => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <ScrollView
      contentContainerStyle={styles.rosterContent}
      horizontal
      keyboardShouldPersistTaps="handled"
      onTouchStart={onDismissKeyboard}
      showsHorizontalScrollIndicator={false}
      style={styles.roster}
    >
      {room.script_snapshot.roles.map((role) => {
        const assignment = room.assignments.find((item) => item.role_id === role.role_id);
        return (
          <View
            accessible
            accessibilityLabel={role.name}
            key={role.role_id || role.client_role_id || role.name}
            style={styles.role}
          >
            <View>
              <ScriptImage
                fallback="person.fill"
                radius={20}
                size={40}
                url={role.avatar_url}
                styles={styles}
              />
              <View
                style={[
                  styles.roleBadge,
                  assignment?.actor_type === "user" ? styles.userBadge : styles.aiBadge,
                ]}
              >
                <SymbolView
                  name={assignment?.actor_type === "user" ? "person.fill" : "sparkles"}
                  size={scriptRoomMetrics.rosterBadgeIconSize}
                  weight="bold"
                  tintColor="#FFFFFF"
                />
              </View>
            </View>
            <Text numberOfLines={1} style={styles.roleName}>
              {role.name}
            </Text>
          </View>
        );
      })}
    </ScrollView>
  );
}

function StoryHeader({
  room,
  styles,
}: {
  room: ScriptRoom;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.storyHeader}>
      <ScriptImage
        fallback="book.closed.fill"
        height={scriptRoomMetrics.storyCoverHeight}
        radius={scriptRoomMetrics.storyCoverRadius}
        styles={styles}
        url={room.script_snapshot.cover_url}
        width={scriptRoomMetrics.storyCoverWidth}
      />
      <Text style={styles.storyText}>{room.script_snapshot.synopsis}</Text>
    </View>
  );
}

function TurnStateView({
  generating,
  onRetry,
  room,
  styles,
  text,
  turnState,
}: {
  generating: boolean;
  onRetry: () => void;
  room: ScriptRoom;
  styles: ReturnType<typeof makeStyles>;
  text: (chinese: string, english: string) => string;
  turnState: ScriptTurnState | null;
}) {
  if (generating) {
    return (
      <View style={styles.turnStatePill}>
        <ActivityIndicator color={styles.accent.color} size="small" />
        <Text style={styles.turnStateText}>
          {turnState?.status === "queued"
            ? text("剧情回合排队中…", "Turn queued…")
            : text("AI 角色正在接续剧情…", "AI character is continuing the story…")}
        </Text>
      </View>
    );
  }
  if (turnState?.status === "failed") {
    return (
      <View style={styles.failedState}>
        <View style={styles.failedTitleRow}>
          <SymbolView
            name="exclamationmark.triangle.fill"
            size={13}
            tintColor={styles.danger.color}
          />
          <Text style={styles.failedTitle}>{text("本轮生成失败", "This turn failed")}</Text>
        </View>
        <Pressable
          accessibilityLabel={text("重试 AI 回复", "Retry AI reply")}
          accessibilityRole="button"
          onPress={onRetry}
          testID="script-room-retry-turn"
        >
          <Text style={styles.failedRetry}>{text("重试 AI 回复", "Retry AI reply")}</Text>
        </Pressable>
      </View>
    );
  }
  if (room.status === "ended") {
    return <Text style={styles.endedState}>{text("剧情已结束", "Story ended")}</Text>;
  }
  return null;
}

function ScriptMessageRow({
  currentPlayer,
  message,
  role,
  styles,
}: {
  currentPlayer: boolean;
  message: GroupMessage;
  role: ScriptRole | undefined;
  styles: ReturnType<typeof makeStyles>;
}) {
  const avatar = scriptMessageAvatar(message, role, currentPlayer);
  return (
    <View style={[styles.messageRow, currentPlayer ? styles.playerRow : styles.aiRow]}>
      {!currentPlayer ? <MessageAvatar avatar={avatar} message={message} styles={styles} /> : null}
      <LinearGradient
        colors={
          currentPlayer
            ? [styles.accent.color, styles.accentDark.color]
            : [styles.card.color, styles.card.color]
        }
        end={{ x: 1, y: 1 }}
        start={{ x: 0, y: 0 }}
        style={[styles.messageBubble, currentPlayer ? styles.playerBubble : styles.receivedBubble]}
      >
        <View style={styles.messageNameRow}>
          <Text style={[styles.messageName, currentPlayer ? styles.playerName : styles.aiName]}>
            {role?.name || message.sender_nickname}
          </Text>
          {!currentPlayer ? <Text style={styles.aiLabel}>AI</Text> : null}
        </View>
        <Text
          selectable
          style={[styles.messageText, currentPlayer ? styles.playerText : styles.receivedText]}
        >
          {message.content}
        </Text>
      </LinearGradient>
      {currentPlayer ? <MessageAvatar avatar={avatar} message={message} styles={styles} /> : null}
    </View>
  );
}

function MessageAvatar({
  avatar,
  message,
  styles,
}: {
  avatar: string | null;
  message: GroupMessage;
  styles: ReturnType<typeof makeStyles>;
}) {
  if (avatar === null) {
    return <Avatar name={message.sender_nickname} size={32} uri={message.sender_avatar} />;
  }
  return <ScriptImage fallback="person.fill" radius={16} size={32} styles={styles} url={avatar} />;
}

function ScriptImage({
  fallback,
  height,
  radius,
  size,
  styles,
  url,
  width,
}: {
  fallback: string;
  height?: number;
  radius: number;
  size?: number;
  styles: ReturnType<typeof makeStyles>;
  url: string;
  width?: number;
}) {
  const resolved = resolveMediaUrl(url, env.apiBaseUrl);
  const imageStyle = { width: size ?? width, height: size ?? height, borderRadius: radius };
  const fallbackView = (
    <LinearGradient
      colors={[styles.scriptAccentLight.color, styles.scriptFallbackEnd.color]}
      end={{ x: 1, y: 1 }}
      start={{ x: 0, y: 0 }}
      style={[imageStyle, styles.imageFallback]}
    >
      <SymbolView
        name={fallback as never}
        size={24}
        weight="semibold"
        tintColor={styles.scriptFallbackIcon.color}
      />
    </LinearGradient>
  );
  return resolved ? (
    <AuthenticatedImage
      contentFit="cover"
      errorFallback={fallbackView}
      fallback={fallbackView}
      loadingFallback={
        <View style={[imageStyle, styles.imageLoading]}>
          <ActivityIndicator color={styles.accent.color} size="small" />
        </View>
      }
      style={imageStyle}
      transition={0}
      uri={resolved}
    />
  ) : (
    fallbackView
  );
}

function makeStyles(scheme: ReturnType<typeof useColorScheme>) {
  const theme = palette(scheme);
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: theme.background },
    accent: { color: theme.accent },
    accentDark: { color: theme.accentDark },
    card: { color: theme.card },
    danger: { color: theme.danger },
    secondaryText: { color: theme.secondaryText },
    scriptAccentLight: { color: "rgba(102,126,234,0.12)" },
    scriptFallbackEnd: { color: "#F2E8FF" },
    scriptFallbackIcon: { color: "rgba(102,126,234,0.7)" },
    menuHost: { width: 30, height: 30 },
    menuTrigger: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
    roster: {
      flexGrow: 0,
      backgroundColor: theme.card,
      borderBottomColor: theme.separator,
      borderBottomWidth: StyleSheet.hairlineWidth,
    },
    rosterContent: {
      gap: scriptRoomMetrics.rosterGap,
      paddingHorizontal: scriptRoomMetrics.rosterHorizontalInset,
      paddingVertical: scriptRoomMetrics.rosterVerticalInset,
    },
    role: {
      width: scriptRoomMetrics.rosterRoleWidth,
      alignItems: "center",
      gap: scriptRoomMetrics.rosterRoleGap,
    },
    roleBadge: {
      position: "absolute",
      right: 0,
      bottom: 0,
      width: 12,
      height: 12,
      borderRadius: 6,
      borderColor: theme.card,
      borderWidth: scriptRoomMetrics.rosterBadgeStroke,
      alignItems: "center",
      justifyContent: "center",
    },
    userBadge: { backgroundColor: theme.success },
    aiBadge: { backgroundColor: theme.accent },
    roleName: {
      width: 52,
      color: theme.secondaryText,
      fontSize: 10,
      fontWeight: "500",
      textAlign: "center",
    },
    timeline: {
      flexGrow: 1,
      gap: scriptRoomMetrics.timelineGap,
      paddingHorizontal: scriptRoomMetrics.timelineHorizontalInset,
      paddingVertical: scriptRoomMetrics.timelineVerticalInset,
    },
    storyHeader: {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 10,
      width: "100%",
      padding: 12,
      borderRadius: 14,
      backgroundColor: scheme === "dark" ? "rgba(27,27,34,0.92)" : "rgba(255,255,255,0.92)",
    },
    storyText: {
      flex: 1,
      color: theme.secondaryText,
      fontSize: 13,
      lineHeight: 18,
      textAlign: "left",
    },
    turnStatePill: {
      alignSelf: "center",
      flexDirection: "row",
      alignItems: "center",
      gap: 9,
      padding: 12,
      borderRadius: 999,
      backgroundColor: theme.card,
    },
    turnStateText: { color: theme.secondaryText, fontSize: 13, fontWeight: "500" },
    failedState: {
      width: "100%",
      alignItems: "center",
      gap: 8,
      padding: 12,
      borderRadius: 12,
      backgroundColor: scheme === "dark" ? "rgba(255,59,48,0.12)" : "rgba(255,59,48,0.06)",
    },
    failedTitleRow: { flexDirection: "row", alignItems: "center", gap: 5 },
    failedTitle: { color: theme.danger, fontSize: 13, fontWeight: "600" },
    failedRetry: { color: theme.accent, fontSize: 13, fontWeight: "600" },
    endedState: {
      alignSelf: "center",
      overflow: "hidden",
      color: theme.secondaryText,
      fontSize: 13,
      fontWeight: "600",
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 999,
      backgroundColor: theme.card,
    },
    messageRow: { width: "100%", flexDirection: "row", alignItems: "flex-end", gap: 8 },
    playerRow: { justifyContent: "flex-end", paddingLeft: scriptRoomMetrics.messageSideSpacer },
    aiRow: { justifyContent: "flex-start", paddingRight: scriptRoomMetrics.messageSideSpacer },
    messageBubble: {
      flexShrink: 1,
      gap: 6,
      paddingHorizontal: 13,
      paddingVertical: 10,
      borderRadius: 16,
    },
    playerBubble: {},
    receivedBubble: {
      borderColor: theme.separator,
      borderWidth: 1,
      shadowColor: "#000000",
      shadowOpacity: 0.055,
      shadowRadius: 4,
      shadowOffset: { width: 0, height: 2 },
    },
    messageNameRow: { flexDirection: "row", alignItems: "center", gap: 5 },
    messageName: { fontSize: 11, fontWeight: "600" },
    playerName: { color: "rgba(255,255,255,0.82)" },
    aiName: { color: theme.secondaryText },
    aiLabel: {
      overflow: "hidden",
      color: theme.accent,
      fontSize: 8,
      fontWeight: "700",
      paddingHorizontal: 4,
      paddingVertical: 1,
      borderRadius: 999,
      backgroundColor: scheme === "dark" ? "rgba(102,126,234,0.20)" : "rgba(102,126,234,0.12)",
    },
    messageText: { fontSize: 15, lineHeight: 20 },
    playerText: { color: theme.white },
    receivedText: { color: scheme === "dark" ? theme.text : "#1A1A2E" },
    imageFallback: {
      overflow: "hidden",
      alignItems: "center",
      justifyContent: "center",
    },
    imageLoading: {
      overflow: "hidden",
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: "rgba(102,126,234,0.12)",
    },
    composer: {
      flexGrow: 0,
      paddingHorizontal: 12,
      paddingTop: 9,
      backgroundColor: theme.card,
      borderTopColor: theme.separator,
      borderTopWidth: StyleSheet.hairlineWidth,
    },
    composerRow: { flexDirection: "row", alignItems: "flex-end", gap: 10 },
    input: {
      flex: 1,
      minHeight: 40,
      maxHeight: 116,
      overflow: "hidden",
      color: theme.text,
      fontSize: 16,
      lineHeight: 20,
      paddingHorizontal: 13,
      paddingVertical: 10,
      borderRadius: 18,
      backgroundColor: theme.background,
    },
    sendButton: {
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: "center",
      justifyContent: "center",
    },
    centerState: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
      padding: 30,
    },
    emptyTitle: { color: theme.text, fontSize: 17, fontWeight: "600", textAlign: "center" },
    emptySubtitle: {
      color: theme.secondaryText,
      fontSize: 14,
      lineHeight: 20,
      textAlign: "center",
    },
  });
}

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : "请求失败，请稍后重试";
}

function scriptRoomSessionKey(ownerId: string, roomId: string): string {
  return `${ownerId}\u001f${roomId}`;
}

function isActiveSession(
  activeOwner: { current: string },
  activeRoomId: { current: string },
  activeGeneration: { current: number },
  requestedOwner: string,
  requestedRoomId: string,
  requestedGeneration: number,
): boolean {
  return (
    activeOwner.current === requestedOwner &&
    activeRoomId.current === requestedRoomId &&
    activeGeneration.current === requestedGeneration
  );
}

async function markScriptRoomRead(
  ownerId: string,
  groupId: number,
  throughMessageId?: number,
): Promise<void> {
  if (!ownerId.trim() || groupId <= 0) return;
  const localClear = clearConversationUnreadLocally(ownerId, "group", String(groupId)).catch(
    () => undefined,
  );
  if (throughMessageId !== undefined && throughMessageId > 0) {
    const remoteRead = markConversationRead(ownerId, "group", String(groupId), throughMessageId);
    await Promise.all([localClear, remoteRead]);
    return;
  }
  const remoteRead = markGroupMessagesRead(groupId).catch(() => null);
  await localClear;
  try {
    const receipt = await remoteRead;
    if (receipt?.conversation_id.trim()) await applyConversationReadReceipt(ownerId, receipt);
  } catch {
    // Read acknowledgements are best effort and must not block the room.
  }
}
