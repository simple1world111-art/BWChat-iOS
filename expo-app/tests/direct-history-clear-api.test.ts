import { apiRequest } from "@/api/client";
import { clearDirectMessageHistory } from "@/api/bwchat";

jest.mock("@/api/client", () => ({
  apiRequest: jest.fn(),
  authenticatedResourceRequest: jest.fn(),
}));

describe("native direct history clear API", () => {
  beforeEach(() => jest.clearAllMocks());

  it("uses the strict encoded DELETE route, required data and a new idempotency key", async () => {
    jest.mocked(apiRequest).mockResolvedValueOnce({
      conversation_id: "friend/1",
      cleared_before_message_id: "88",
      cleared_at: "2026-08-08T10:00:00Z",
      revision: "2",
    });

    await expect(clearDirectMessageHistory("friend/1")).resolves.toEqual({
      conversation_id: "friend/1",
      cleared_before_message_id: 88,
      cleared_at: "2026-08-08T10:00:00Z",
      revision: 2,
    });
    expect(apiRequest).toHaveBeenCalledWith("/chat/messages/friend%2F1/history", {
      method: "DELETE",
      headers: { "Idempotency-Key": expect.any(String) },
      requiredData: true,
      requiredEnvelope: true,
    });
  });

  it("uses the requested contact when the flexible receipt omits its id", async () => {
    jest.mocked(apiRequest).mockResolvedValueOnce({
      cleared_before_id: 5,
    });
    await expect(clearDirectMessageHistory("friend-2")).resolves.toEqual({
      conversation_id: "friend-2",
      cleared_before_message_id: 5,
      revision: 0,
    });
  });
});
