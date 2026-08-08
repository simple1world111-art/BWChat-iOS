import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

describe("mention picker source parity", () => {
  it("connects standalone-at detection, replacement range and mention wire fields to group chat", () => {
    const groupChat = fs.readFileSync(path.join(root, "src/app/group-chat/[id].tsx"), "utf8");
    expect(groupChat).toContain("isStandaloneAtInsertion(draft, edit.range, edit.replacementText)");
    expect(groupChat).toContain(
      "setPendingMentionTriggerRange({ location: edit.range.location, length: 1 })",
    );
    expect(groupChat).toContain("insertChatMentions(");
    expect(groupChat).toContain("mentionedUserIds({ text: draft, mentions: composerMentions })");
    expect(groupChat).toContain("mentionsAll({ text: draft, mentions: composerMentions })");
    expect(groupChat).toContain("mentions: outgoingMentions");
    expect(groupChat).toContain("mention_all: outgoingMentionAll");
    expect(groupChat).toContain("mentions: sendingJob.mentions ?? []");
    expect(groupChat).toContain("mentionAll: sendingJob.mention_all");
  });

  it("keeps the audited native picker states and visual metrics", () => {
    const picker = fs.readFileSync(
      path.join(root, "src/components/messages/ChatMentionPicker.tsx"),
      "utf8",
    );
    for (const source of [
      "allowsMentionAll && !query.trim()",
      "normalizeMentionMembers(initialMembers, user?.user_id)",
      "loadCachedGroupDetail(ownerId, groupId)",
      "getGroupDetail(groupId)",
      "size={38}",
      "size={21}",
      "fontSize: 16",
      "fontSize: 12",
    ])
      expect(picker).toContain(source);
  });
});
