import type { MenuAction } from "@expo/ui/community/menu";

import type { MomentComment } from "@/models";

export function momentCommentContextActions(
  comment: MomentComment,
  translate: (key: string, ...args: (string | number)[]) => string,
): MenuAction[] {
  return [
    {
      id: "comment-author-profile",
      title: translate("profile.public.title"),
      image: "person.crop.circle",
    },
    ...(comment.reply_to
      ? [
          {
            id: "reply-author-profile",
            title: comment.reply_to.nickname,
            image: "arrowshape.turn.up.left" as const,
          },
        ]
      : []),
  ];
}

export function momentCommentContextUserId(
  comment: MomentComment,
  actionId: string,
): string | null {
  if (actionId === "comment-author-profile") return comment.user_id;
  if (actionId === "reply-author-profile") return comment.reply_to?.user_id ?? null;
  return null;
}
