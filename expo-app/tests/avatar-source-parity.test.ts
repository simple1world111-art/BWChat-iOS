import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const projectRoot = resolve(__dirname, "..");
const nativeAvatar = readFileSync(
  resolve(projectRoot, "../BWChat/Components/AvatarView.swift"),
  "utf8",
);
const expoAvatar = readFileSync(resolve(projectRoot, "src/components/Avatar.tsx"), "utf8");

describe("AvatarView source parity", () => {
  it("preserves the native geometry, symbol and no-transition load fallback", () => {
    expect(nativeAvatar).toContain("cornerRadius: size * 0.22");
    expect(nativeAvatar).toContain('Image(systemName: "person.fill")');
    expect(nativeAvatar).toContain("size * 0.38");
    expect(expoAvatar).toContain("cornerRadius ?? size * 0.22");
    expect(expoAvatar).toContain('name="person.fill"');
    expect(expoAvatar).toContain("size={size * 0.38}");
    expect(expoAvatar).toContain("start={{ x: 0, y: 0 }}");
    expect(expoAvatar).toContain("end={{ x: 1, y: 1 }}");
    expect(expoAvatar).toContain("transition={0}");
    expect(expoAvatar).toContain("errorFallback={fallback}");
  });

  it("preserves exclusive 0.45 second long press and 0.6 second navigation throttle", () => {
    expect(nativeAvatar).toContain("LongPressGesture(minimumDuration: 0.45)");
    expect(nativeAvatar).toContain("now.timeIntervalSince(lastOpenAt) > 0.6");
    expect(expoAvatar).toContain("delayLongPress={450}");
    expect(expoAvatar).toContain("now - lastOpenAt.current <= 600");
    expect(expoAvatar).toContain("now - lastLongPressAt.current < 600");
  });

  it("uses the shared user-avatar behavior in direct chat, group chat and group member surfaces", () => {
    for (const relativePath of [
      "src/app/chat/[id].tsx",
      "src/app/group-chat/[id].tsx",
      "src/app/group-detail.tsx",
      "src/app/group-members.tsx",
      "src/app/add-friend.tsx",
      "src/app/short-drama-series.tsx",
      "src/components/messages/ChatGiftViews.tsx",
    ]) {
      expect(readFileSync(resolve(projectRoot, relativePath), "utf8")).toContain(
        "UserAvatarButton",
      );
    }
  });
});
