import { removeGroupMember } from "@/api/bwchat";
import { APIError } from "@/api/client";
import { executeGroupMemberRemoval } from "@/services/groups/GroupMembersRemoval";

jest.mock("@/api/bwchat", () => ({ removeGroupMember: jest.fn() }));

const remove = jest.mocked(removeGroupMember);

describe("native group-member removal coordinator", () => {
  beforeEach(() => remove.mockReset());

  it("posts first, removes locally, then starts the parent callback", async () => {
    const order: string[] = [];
    remove.mockImplementation(async () => {
      order.push("post");
    });

    await executeGroupMemberRemoval(21, "alice-id", {
      onRemoved: () => order.push("local-remove"),
      onChanged: () => order.push("parent-refresh"),
      onError: () => order.push("error"),
    });

    expect(remove).toHaveBeenCalledWith(21, "alice-id");
    expect(order).toEqual(["post", "local-remove", "parent-refresh"]);
  });

  it("keeps rows and parent refresh untouched on failure", async () => {
    const error = new APIError("不能移除群主", 409);
    remove.mockRejectedValue(error);
    const onRemoved = jest.fn();
    const onChanged = jest.fn();
    const onError = jest.fn();

    await executeGroupMemberRemoval(21, "owner-a", { onRemoved, onChanged, onError });

    expect(onRemoved).not.toHaveBeenCalled();
    expect(onChanged).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(error);
  });
});
