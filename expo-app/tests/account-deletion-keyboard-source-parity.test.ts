import fs from "node:fs";
import path from "node:path";

describe("account deletion keyboard avoidance", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src/app/account-deletion.tsx"), "utf8");

  it("reserves keyboard space without applying a second automatic inset", () => {
    expect(source).toMatch(
      /<KeyboardAvoidingView\s+behavior=\{Platform\.OS === "ios" \? "padding" : undefined\}/u,
    );
    expect(source).toContain("automaticallyAdjustKeyboardInsets={false}");
    expect(source).toContain("style={styles.screen}");
  });

  it("moves each confirmation field above the keyboard when focused", () => {
    expect(source).toContain("ref={scrollRef}");
    expect(source).toContain("scrollResponderScrollNativeHandleToKeyboard(");
    expect(source).toContain("deletionInputKeyboardClearance");
    expect(source.match(/onFocus=\{revealDeletionInput\}/gu)).toHaveLength(2);
  });
});
