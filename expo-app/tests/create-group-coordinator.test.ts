import { createGroup, getGroups } from "@/api/bwchat";
import { createGroupWithNativeRefresh } from "@/services/groups/CreateGroupCoordinator";
import { loadGroupsWithNativeCache } from "@/services/groups/GroupRepository";

jest.mock("@/api/bwchat", () => ({
  createGroup: jest.fn(),
  getGroups: jest.fn(),
}));
jest.mock("@/services/groups/GroupRepository", () => ({
  loadGroupsWithNativeCache: jest.fn(),
}));

const create = jest.mocked(createGroup);
const load = jest.mocked(loadGroupsWithNativeCache);
const input = {
  name: "周末群",
  memberIds: ["7", "8"],
  isPublic: true,
  ownerId: "owner-a",
};

describe("native CreateGroup success coordinator", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    create.mockResolvedValue(undefined);
    load.mockResolvedValue([]);
  });

  it("creates first and then runs the GroupsViewModel cache load", async () => {
    const order: string[] = [];
    create.mockImplementation(async () => {
      order.push("create");
    });
    load.mockImplementation(async () => {
      order.push("load-groups");
      return [];
    });

    await expect(createGroupWithNativeRefresh(input)).resolves.toBe(true);
    expect(create).toHaveBeenCalledWith("周末群", ["7", "8"], true);
    expect(load).toHaveBeenCalledWith("owner-a", getGroups);
    expect(order).toEqual(["create", "load-groups"]);
  });

  it("keeps a successful create successful when list reload fails", async () => {
    load.mockRejectedValue(new Error("list offline"));
    await expect(createGroupWithNativeRefresh(input)).resolves.toBe(true);
  });

  it("does not fetch another account's groups when the submitting owner changed", async () => {
    const isOwnerCurrent = jest.fn(() => false);
    await expect(createGroupWithNativeRefresh({ ...input, isOwnerCurrent })).resolves.toBe(true);
    expect(isOwnerCurrent).toHaveBeenCalledTimes(1);
    expect(load).not.toHaveBeenCalled();
  });

  it("rejects an ownerless submission before creating or caching", async () => {
    await expect(createGroupWithNativeRefresh({ ...input, ownerId: "  " })).resolves.toBe(false);
    expect(create).not.toHaveBeenCalled();
    expect(load).not.toHaveBeenCalled();
  });

  it("keeps the page open and skips list reload when create fails", async () => {
    const failure = new Error("create failed");
    create.mockRejectedValue(failure);
    await expect(createGroupWithNativeRefresh(input)).rejects.toBe(failure);
    expect(load).not.toHaveBeenCalled();
  });
});
