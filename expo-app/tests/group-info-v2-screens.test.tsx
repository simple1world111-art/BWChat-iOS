import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactNode } from "react";
import { Alert } from "react-native";

import GroupAnnouncementScreen from "@/app/group-announcement";
import GroupInviteScreen from "@/app/group-invite";
import GroupInvitePreviewScreen from "@/app/group-invite-preview";
import GroupReportScreen from "@/app/group-report";

let mockParams: Record<string, string> = {};
const mockBack = jest.fn();
const mockReplace = jest.fn();
const mockAcceptInvite = jest.fn();
const mockCreateInvite = jest.fn();
const mockGetGroupDetail = jest.fn();
const mockGetInvitePreview = jest.fn();
const mockReportGroup = jest.fn();
const mockRevokeInvite = jest.fn();
const mockUpdateAnnouncement = jest.fn();
const mockApplyAnnouncement = jest.fn();
const mockT = (key: string, ...args: (string | number)[]) => [key, ...args].join("|");

jest.mock("expo-router", () => ({
  router: { back: mockBack, replace: mockReplace },
  Stack: {
    Screen: ({ options }: { options?: { headerRight?: () => ReactNode } }) =>
      options?.headerRight?.() ?? null,
  },
  useLocalSearchParams: () => mockParams,
}));

jest.mock("expo-symbols", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return { SymbolView: ({ name }: { name: string }) => <MockText>{name}</MockText> };
});

jest.mock("react-native-qrcode-svg", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  function MockQRCode({ value }: { value: string }) {
    return <MockText>{`qr:${value}`}</MockText>;
  }
  return MockQRCode;
});

jest.mock("@/providers/LocalizationProvider", () => ({
  useLocalization: () => ({ t: mockT }),
}));

jest.mock("@/providers/AuthProvider", () => ({
  useAuth: () => ({ user: { user_id: "owner-a" } }),
}));

jest.mock("@/services/groups/GroupDetailRepository", () => ({
  applyGroupAnnouncementUpdate: (...args: unknown[]) => mockApplyAnnouncement(...args),
}));

jest.mock("@/components/Avatar", () => {
  const { Text: MockText } = jest.requireActual("react-native");
  return { Avatar: ({ name }: { name: string }) => <MockText>{`avatar:${name}`}</MockText> };
});

jest.mock("@/api/bwchat", () => ({
  getGroupDetail: (...args: unknown[]) => mockGetGroupDetail(...args),
}));

jest.mock("@/services/groups/GroupInfoV2Repository", () => ({
  acceptGroupInvite: (...args: unknown[]) => mockAcceptInvite(...args),
  createGroupInvite: (...args: unknown[]) => mockCreateInvite(...args),
  getGroupInvitePreview: (...args: unknown[]) => mockGetInvitePreview(...args),
  reportGroup: (...args: unknown[]) => mockReportGroup(...args),
  revokeGroupInvite: (...args: unknown[]) => mockRevokeInvite(...args),
  updateGroupAnnouncement: (...args: unknown[]) => mockUpdateAnnouncement(...args),
}));

describe("GroupInfo v2 screen interactions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, "alert").mockImplementation(jest.fn());
    mockCreateInvite.mockResolvedValue({
      invite_id: "invite-1",
      group_id: 21,
      invite_url: "bwchat://group-invite/token-1",
      expires_at: "2026-08-15T00:00:00Z",
    });
    mockAcceptInvite.mockResolvedValue({ group_id: 21, already_member: false });
    mockGetGroupDetail.mockResolvedValue({ group_id: 21 });
    mockGetInvitePreview.mockResolvedValue({
      group_id: 21,
      group_name: "周末群",
      avatar_url: "",
      member_count: 8,
      inviter_nickname: "群主",
      expires_at: "2026-08-15T00:00:00Z",
      is_member: false,
      can_join: true,
    });
    mockRevokeInvite.mockResolvedValue(undefined);
    mockReportGroup.mockResolvedValue(undefined);
    mockUpdateAnnouncement.mockResolvedValue({
      announcement_id: "a-1",
      group_id: 21,
      title: "规则",
      content: "友好聊天",
      revision: 1,
    });
    mockApplyAnnouncement.mockResolvedValue(undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it("trims and submits the selected native group-report reason and detail", async () => {
    mockParams = { id: "21" };
    await render(<GroupReportScreen />);
    await fireEvent.press(screen.getByText("group.report.reason.fraud"));
    const detail = screen.getByLabelText("group.report.detail");
    await fireEvent.changeText(detail, "  证据  ");
    await act(async () => {
      fireEvent.press(screen.getByText("group.report.submit"));
    });
    expect(mockReportGroup).toHaveBeenCalledWith(21, "fraud", "证据");
    expect(Alert.alert).toHaveBeenCalledWith("group.report.success", undefined, expect.any(Array));
  });

  it("requires announcement content, trims both fields and returns after saving", async () => {
    mockParams = { id: "21", canEdit: "true", title: " 规则 " };
    await render(<GroupAnnouncementScreen />);
    await fireEvent.changeText(
      screen.getByLabelText("group.announcement.contentField"),
      " 友好聊天 ",
    );
    await act(async () => {
      fireEvent.press(screen.getByText("common.save"));
    });
    expect(mockUpdateAnnouncement).toHaveBeenCalledWith(21, "规则", "友好聊天");
    expect(mockApplyAnnouncement).toHaveBeenCalledWith(
      "owner-a",
      expect.objectContaining({ group_id: 21, revision: 1 }),
    );
    expect(readFileSync(resolve(__dirname, "../src/app/group-announcement.tsx"), "utf8")).toContain(
      "router.back()",
    );
  });

  it("keeps invite generation and revoke as separate locked operations", async () => {
    mockParams = { id: "21", name: "周末群" };
    await render(<GroupInviteScreen />);
    await act(async () => {
      fireEvent.press(screen.getByText("group.invite.generate"));
    });
    await waitFor(() => expect(screen.getByText("qr:bwchat://group-invite/token-1")).toBeTruthy());
    expect(mockCreateInvite).toHaveBeenCalledWith(21);

    await act(async () => {
      fireEvent.press(screen.getByText("group.invite.revoke"));
    });
    expect(mockRevokeInvite).toHaveBeenCalledWith(21, "invite-1");
    expect(screen.queryByText("qr:bwchat://group-invite/token-1")).toBeNull();
  });

  it("accepts a preview invite once, verifies group detail and opens the group chat", async () => {
    mockParams = { token: "abcDEF_123-xyz", delivery: "1" };
    await render(<GroupInvitePreviewScreen />);
    await waitFor(() => expect(screen.getByText("group.invite.join")).toBeTruthy());
    await act(async () => {
      fireEvent.press(screen.getByText("group.invite.join"));
    });
    await waitFor(() => expect(mockGetGroupDetail).toHaveBeenCalledWith(21));
    expect(mockAcceptInvite).toHaveBeenCalledWith("abcDEF_123-xyz");
    expect(readPreviewSource()).toContain('pathname: "/group-chat/[id]"');
    expect(readPreviewSource()).toContain("params: { id: String(groupId) }");
  });
});

function readPreviewSource(): string {
  return readFileSync(resolve(__dirname, "../src/app/group-invite-preview.tsx"), "utf8");
}
