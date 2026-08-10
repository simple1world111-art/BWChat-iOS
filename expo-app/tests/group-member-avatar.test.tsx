import { render } from "@testing-library/react-native";

import { GroupMemberAvatar } from "@/components/GroupMemberAvatar";

const mockLoadCachedGroupDetailSnapshot = jest.fn(
  (_ownerId: string, _groupId: number) => new Promise(() => undefined),
);
const mockPeekCachedGroupDetail = jest.fn((_ownerId: string, _groupId: number): unknown => null);

jest.mock("@/api/bwchat", () => ({ getGroupDetail: jest.fn() }));

jest.mock("@/components/Avatar", () => {
  const { Text } = jest.requireActual("react-native");
  return { Avatar: ({ name }: { name: string }) => <Text>{`member:${name}`}</Text> };
});

jest.mock("@/components/GroupAvatarIcon", () => {
  const { Text } = jest.requireActual("react-native");
  return { GroupAvatarIcon: () => <Text>generic-group-avatar</Text> };
});

jest.mock("@/providers/AuthProvider", () => ({
  useAuth: () => ({ user: { user_id: "owner-a" } }),
}));

jest.mock("@/services/groups/GroupDetailRepository", () => ({
  groupDetailGeneration: jest.fn(() => 0),
  groupMemberDisplayName: (member: { nickname: string }) => member.nickname,
  loadCachedGroupDetailSnapshot: (ownerId: string, groupId: number) =>
    mockLoadCachedGroupDetailSnapshot(ownerId, groupId),
  peekCachedGroupDetail: (ownerId: string, groupId: number) =>
    mockPeekCachedGroupDetail(ownerId, groupId),
  saveCachedGroupDetail: jest.fn(),
  subscribeGroupDetail: jest.fn(() => () => undefined),
}));

describe("GroupMemberAvatar", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPeekCachedGroupDetail.mockReturnValue({
      detail: {
        group_id: 21,
        members: [
          { user_id: "one", nickname: "小一", avatar_url: "/one.jpg" },
          { user_id: "two", nickname: "小二", avatar_url: "/two.jpg" },
        ],
      },
      savedAt: Date.now(),
      isFresh: true,
    });
  });

  it("renders the synchronous collage snapshot on every mount while disk revalidation is pending", async () => {
    const first = await render(<GroupMemberAvatar groupId={21} size={48} />);
    expect(first.getByText("member:小一")).toBeTruthy();
    expect(first.getByText("member:小二")).toBeTruthy();
    expect(first.queryByText("generic-group-avatar")).toBeNull();
    await first.unmount();

    const remounted = await render(<GroupMemberAvatar groupId={21} size={48} />);
    expect(remounted.getByText("member:小一")).toBeTruthy();
    expect(remounted.getByText("member:小二")).toBeTruthy();
    expect(remounted.queryByText("generic-group-avatar")).toBeNull();
    await remounted.unmount();
  });
});
