import {
  createAgentConversation,
  createAgentTurn,
  endCall,
  getAgent,
  getAgentMessages,
  markAgentMessagesRead,
  getAgentRuntimeConfig,
  getAgentTurn,
  getWalletBalance,
  unlockAgentMedia,
  uploadAgentChatImage,
} from "@/api/bwchat";
import { apiRequest } from "@/api/client";
import { getAgentConversation } from "@/services/agents/AgentConversationRepository";
import {
  cancelAgentLiveMatch,
  getCurrentLiveSlot,
  joinAcceptedLiveCall,
  startAgentLiveMatch,
} from "@/services/live/LiveLobbyRepository";

jest.mock("@/api/client", () => ({
  APIError: class APIError extends Error {},
  apiRequest: jest.fn(),
}));

const request = jest.mocked(apiRequest);
const rejected = new Error("contract-probe");

async function probe(operation: Promise<unknown>): Promise<void> {
  await expect(operation).rejects.toBe(rejected);
}

describe("AgentChat thirteen backend chains", () => {
  beforeEach(() => {
    request.mockReset();
    request.mockRejectedValue(rejected);
  });

  it("locks conversation, runtime, wallet and paged history reads", async () => {
    await probe(getAgentConversation("conversation/a"));
    await probe(getAgentRuntimeConfig());
    await probe(getWalletBalance());
    await probe(getAgentMessages("conversation/a", { beforeSequence: 41, limit: 30 }));

    expect(request.mock.calls).toEqual([
      ["/agent-conversations/conversation%2Fa", { requiredData: true }],
      ["/agents/runtime-config", { requiredData: true, requiredEnvelope: true, timeoutMs: 60_000 }],
      ["/wallet/balance", { requiredData: true, requiredEnvelope: true, timeoutMs: 60_000 }],
      ["/agent-conversations/conversation%2Fa/messages?limit=30&before_sequence=41"],
    ]);
  });

  it("marks an agent conversation through a canonical sequence and message", async () => {
    await probe(
      markAgentMessagesRead("conversation/a", {
        throughSequence: 42,
        throughMessageId: "message/a",
        idempotencyKey: "read-agent",
      }),
    );
    expect(request).toHaveBeenCalledWith("/agent-conversations/conversation%2Fa/read", {
      method: "POST",
      headers: { "Idempotency-Key": "read-agent" },
      requiredEnvelope: true,
      body: {
        idempotency_key: "read-agent",
        through_sequence: 42,
        through_message_id: "message/a",
      },
    });
  });

  it("locks image upload, turn creation/polling and paid-media unlock mutations", async () => {
    await probe(uploadAgentChatImage("file:///prepared.jpg", "upload-key", "agent_uuid.jpg"));
    await probe(
      createAgentTurn(
        "conversation/a",
        [
          { type: "text", text: "调整" },
          { type: "input_image", asset_id: "asset-1" },
        ],
        { clientMessageId: "client-key", replyToId: "reply-1", idempotencyKey: "turn-key" },
      ),
    );
    await probe(getAgentTurn("turn/a"));
    await probe(
      unlockAgentMedia("media/a", { type: "automatic", mediaType: "image" }, "unlock-key"),
    );

    expect(request.mock.calls[0]).toEqual([
      "/agent-assets/images",
      {
        method: "POST",
        headers: { "Idempotency-Key": "upload-key" },
        body: expect.any(FormData),
        timeoutMs: 90_000,
      },
    ]);
    expect(request.mock.calls.slice(1)).toEqual([
      [
        "/agent-conversations/conversation%2Fa/turns",
        {
          method: "POST",
          headers: { "Idempotency-Key": "turn-key" },
          timeoutMs: 30_000,
          body: {
            client_message_id: "client-key",
            parts: [
              { type: "text", text: "调整" },
              { type: "input_image", asset_id: "asset-1" },
            ],
            reply_to_id: "reply-1",
          },
        },
      ],
      ["/agent-turns/turn%2Fa"],
      [
        "/agent-media/media%2Fa/unlock",
        {
          method: "POST",
          headers: { "Idempotency-Key": "unlock-key" },
          body: { payment_method: "auto", prop_definition_id: "media_unlock_card_image" },
          requiredData: true,
          transientRetries: false,
        },
      ],
    ]);
  });

  it("locks editor lookup and latest-version conversation creation", async () => {
    await probe(getAgent("agent/a"));
    await probe(createAgentConversation("agent/a", "default", "conversation-key"));
    expect(request.mock.calls).toEqual([
      ["/agents/agent%2Fa", { requiredData: true, requiredSuccessCode: true, timeoutMs: 60_000 }],
      [
        "/agent-conversations",
        {
          method: "POST",
          headers: { "Idempotency-Key": "conversation-key" },
          body: { agent_id: "agent/a", greeting_id: "default" },
          requiredData: true,
          timeoutMs: 15_000,
          transientRetries: false,
        },
      ],
    ]);
  });

  it("locks current-live, match/cancel and join/end cleanup chains", async () => {
    await probe(getCurrentLiveSlot());
    await probe(
      startAgentLiveMatch({
        roleSetting: "温柔陪伴",
        sourceAgentId: "agent/a",
        clientMatchId: "match-key",
      }),
    );
    await probe(cancelAgentLiveMatch("match/a"));
    await probe(joinAcceptedLiveCall("call/a"));
    await probe(endCall("call/a"));

    expect(request.mock.calls).toEqual([
      ["/one-to-one-live/slots/me/current", { cache: "no-store", requiredEnvelope: true }],
      [
        "/one-to-one-live/matches",
        {
          method: "POST",
          body: {
            role_setting: "温柔陪伴",
            source_agent_id: "agent/a",
            client_match_id: "match-key",
          },
          requiredData: true,
        },
      ],
      ["/one-to-one-live/matches/match%2Fa/cancel", { method: "POST", body: {} }],
      [
        "/one-to-one-live/calls/call%2Fa/join",
        { method: "POST", body: {}, requiredData: true, requiredEnvelope: true },
      ],
      [
        "/call/call%2Fa/end",
        {
          method: "POST",
          body: {},
          requiredEnvelope: true,
          transientRetries: false,
        },
      ],
    ]);
  });
});
