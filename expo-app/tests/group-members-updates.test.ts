import {
  notifyGroupMembersAdded,
  subscribeGroupMembersAdded,
} from "@/services/groups/GroupMembersUpdates";

describe("group-members success callback bridge", () => {
  it("delivers valid group ids and removes cancelled subscriptions", () => {
    const first = jest.fn();
    const second = jest.fn();
    const cancelFirst = subscribeGroupMembersAdded(first);
    const cancelSecond = subscribeGroupMembersAdded(second);

    notifyGroupMembersAdded(21);
    cancelFirst();
    notifyGroupMembersAdded(22);
    cancelSecond();
    notifyGroupMembersAdded(0);
    notifyGroupMembersAdded(2.5);

    expect(first).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledWith(21);
    expect(second.mock.calls).toEqual([[21], [22]]);
  });
});
