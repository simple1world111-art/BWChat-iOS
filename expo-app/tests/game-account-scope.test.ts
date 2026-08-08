import { GameAccountScope } from "@/services/games/GameAccountScope";

describe("game account operation scope", () => {
  it("keeps tickets current within one account and invalidates every late A completion after A to B", () => {
    const scope = new GameAccountScope("owner-a");
    const first = scope.capture();
    const second = scope.capture();
    expect(scope.isCurrent(first)).toBe(true);
    expect(scope.isCurrent(second)).toBe(true);
    expect(scope.updateOwner("owner-a")).toBe(false);

    expect(scope.updateOwner("owner-b")).toBe(true);
    expect(scope.isCurrent(first)).toBe(false);
    expect(scope.isCurrent(second)).toBe(false);
    expect(scope.isCurrent(scope.capture())).toBe(true);
  });

  it("invalidates work when the owner signs out", () => {
    const scope = new GameAccountScope("owner");
    const ticket = scope.capture();
    expect(scope.updateOwner("")).toBe(true);
    expect(scope.isCurrent(ticket)).toBe(false);
  });
});
