import { markMomentsNotificationsRead } from "@/api/bwchat";
import { markMomentsNotificationsReadEverywhere } from "@/services/moments/MomentsReadService";
import { dismissReadMomentsNotifications } from "@/services/push/PushService";

jest.mock("@/api/bwchat", () => ({ markMomentsNotificationsRead: jest.fn() }));
jest.mock("@/services/push/PushService", () => ({
  dismissReadMomentsNotifications: jest.fn(),
}));

const markRemoteRead = jest.mocked(markMomentsNotificationsRead);
const dismissPresented = jest.mocked(dismissReadMomentsNotifications);

describe("Moments read notification synchronization", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    markRemoteRead.mockResolvedValue();
    dismissPresented.mockResolvedValue(0);
  });

  it("dismisses delivered Moments pushes after the server accepts the read", async () => {
    dismissPresented.mockResolvedValue(2);

    await markMomentsNotificationsReadEverywhere();

    expect(markRemoteRead).toHaveBeenCalledTimes(1);
    expect(dismissPresented).toHaveBeenCalledTimes(1);
  });

  it("keeps delivered pushes when the server read request fails", async () => {
    markRemoteRead.mockRejectedValue(new Error("offline"));

    await expect(markMomentsNotificationsReadEverywhere()).rejects.toThrow("offline");
    expect(dismissPresented).not.toHaveBeenCalled();
  });
});
