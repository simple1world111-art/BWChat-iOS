import { ConversationAccountScope } from "@/services/conversations/ConversationAccountScope";

describe("conversation account operation scope", () => {
  it("invalidates every late A completion after A→B and after A→B→A", () => {
    const scope = new ConversationAccountScope("owner-a");
    const originalA = scope.capture();
    expect(scope.isCurrent(originalA)).toBe(true);

    expect(scope.updateOwner("owner-b")).toBe(true);
    expect(scope.isCurrent(originalA)).toBe(false);
    const ownerB = scope.capture();

    expect(scope.updateOwner("owner-a")).toBe(true);
    expect(scope.isCurrent(originalA)).toBe(false);
    expect(scope.isCurrent(ownerB)).toBe(false);
    expect(scope.isCurrent(scope.capture())).toBe(true);
  });

  it("invalidates work when the user signs out but not for a duplicate owner update", () => {
    const scope = new ConversationAccountScope("owner");
    const ticket = scope.capture();
    expect(scope.updateOwner("owner")).toBe(false);
    expect(scope.isCurrent(ticket)).toBe(true);
    expect(scope.updateOwner("")).toBe(true);
    expect(scope.isCurrent(ticket)).toBe(false);
  });
});
