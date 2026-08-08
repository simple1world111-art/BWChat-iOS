import fs from "node:fs";
import path from "node:path";

import type { MomentComment } from "@/models";
import {
  momentCommentContextActions,
  momentCommentContextUserId,
} from "@/services/moments/MomentCommentContextPolicy";

describe("Moments comment native context menu", () => {
  it("opens the comment author's profile and keeps a regular tap available for reply", () => {
    const comment = row();
    expect(momentCommentContextActions(comment, (key) => key)).toEqual([
      {
        id: "comment-author-profile",
        title: "profile.public.title",
        image: "person.crop.circle",
      },
    ]);
    expect(momentCommentContextUserId(comment, "comment-author-profile")).toBe("comment-author");
    expect(momentCommentContextUserId(comment, "unknown")).toBeNull();

    const source = read("src/components/profile/PublicProfileContent.tsx");
    expect(source).toContain("shouldOpenOnLongPress");
    expect(source).toContain("onComment({");
  });

  it("adds the replied-to profile using the original nickname label", () => {
    const comment = row({
      reply_to: {
        user_id: "reply-author",
        nickname: "被回复者",
        avatar_url: "",
      },
    });
    expect(momentCommentContextActions(comment, (key) => key)[1]).toEqual({
      id: "reply-author-profile",
      title: "被回复者",
      image: "arrowshape.turn.up.left",
    });
    expect(momentCommentContextUserId(comment, "reply-author-profile")).toBe("reply-author");
  });

  it("locks the two native Swift context-menu destinations", () => {
    const native = read("../BWChat/Views/MomentsView.swift");
    expect(native).toContain(".contextMenu {");
    expect(native).toContain("openProfile(userID: comment.userID)");
    expect(native).toContain("openProfile(userID: replyTo.userID)");
  });
});

function row(overrides: Partial<MomentComment> = {}): MomentComment {
  return {
    id: 1,
    content: "评论",
    user_id: "comment-author",
    nickname: "评论者",
    avatar_url: "",
    ...overrides,
  };
}

function read(relative: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relative), "utf8");
}
