import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";

import { getGroupDetail } from "@/api/bwchat";
import { Avatar } from "@/components/Avatar";
import { GroupAvatarIcon } from "@/components/GroupAvatarIcon";
import type { GroupDetail, GroupMember } from "@/models";
import { useAuth } from "@/providers/AuthProvider";
import {
  groupDetailGeneration,
  groupMemberDisplayName,
  loadCachedGroupDetailSnapshot,
  peekCachedGroupDetail,
  saveCachedGroupDetail,
  subscribeGroupDetail,
} from "@/services/groups/GroupDetailRepository";

const spacing = 1.5;
const inset = 3;

export function GroupMemberAvatar({
  groupId,
  onDetail,
  size,
}: {
  groupId: number;
  onDetail?: ((detail: GroupDetail) => void) | undefined;
  size: number;
}) {
  const { user } = useAuth();
  const ownerId = user?.user_id ?? "";
  const memoryDetail = peekCachedGroupDetail(ownerId, groupId)?.detail ?? null;
  const [detailState, setDetailState] = useState<GroupAvatarDetailState>({
    ownerId: "",
    groupId: 0,
    detail: null,
  });
  const onDetailRef = useRef(onDetail);
  useEffect(() => {
    onDetailRef.current = onDetail;
  }, [onDetail]);

  useEffect(() => {
    if (!ownerId || !Number.isInteger(groupId) || groupId <= 0) return;
    let active = true;
    const apply = (detail: GroupDetail) => {
      if (!active || detail.group_id !== groupId) return;
      setDetailState({ ownerId, groupId, detail });
      onDetailRef.current?.(detail);
    };
    const cacheGeneration = groupDetailGeneration(ownerId, groupId);
    const unsubscribe = subscribeGroupDetail(ownerId, apply);
    const memorySnapshot = peekCachedGroupDetail(ownerId, groupId);
    if (memorySnapshot) apply(memorySnapshot.detail);
    void (async () => {
      const cached = await loadCachedGroupDetailSnapshot(ownerId, groupId);
      if (!active) return;
      if (cached) apply(cached.detail);
      if (cached?.isFresh) return;
      try {
        const detail = await getGroupDetail(groupId);
        if (!active) return;
        const resolved = await saveCachedGroupDetail(ownerId, detail, cacheGeneration);
        if (!active || cacheGeneration !== groupDetailGeneration(ownerId, groupId)) return;
        apply(resolved);
      } catch {
        // Native preserves the cached collage (or the generic group icon) on failure.
      }
    })();
    return () => {
      active = false;
      unsubscribe();
    };
  }, [groupId, ownerId]);

  const detailIsCurrent = detailState.ownerId === ownerId && detailState.groupId === groupId;
  const detail = detailIsCurrent ? detailState.detail : memoryDetail;
  const displayed = detail?.members.slice(0, 9) ?? [];
  if (displayed.length === 0) return <GroupAvatarIcon size={size} />;

  const columns = displayed.length === 1 ? 1 : displayed.length <= 4 ? 2 : 3;
  const memberSize = Math.floor((size - inset * 2 - spacing * (columns - 1)) / columns);
  const firstRowCount = displayed.length % columns || columns;
  const rows: GroupMember[][] = [];
  for (let start = 0, count = firstRowCount; start < displayed.length; count = columns) {
    rows.push(displayed.slice(start, start + count));
    start += count;
  }

  return (
    <View
      accessibilityLabel={displayed.map(memberName).filter(Boolean).join("、") || undefined}
      style={[
        styles.avatar,
        {
          width: size,
          height: size,
          borderRadius: size * 0.18,
          padding: inset,
          rowGap: spacing,
        },
      ]}
    >
      {rows.map((row, rowIndex) => (
        <View
          key={`${rowIndex}:${row.map((member) => member.user_id).join(":")}`}
          style={styles.row}
        >
          {row.map((member, memberIndex) => (
            <Avatar
              key={`${member.user_id}:${memberIndex}`}
              cornerRadius={memberSize * 0.22}
              name={memberName(member)}
              size={memberSize}
              uri={member.avatar_url}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

interface GroupAvatarDetailState {
  ownerId: string;
  groupId: number;
  detail: GroupDetail | null;
}

function memberName(member: GroupMember): string {
  return groupMemberDisplayName(member);
}

const styles = StyleSheet.create({
  avatar: {
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#E5E5EA",
  },
  row: {
    flexDirection: "row",
    justifyContent: "center",
    columnGap: spacing,
  },
});
