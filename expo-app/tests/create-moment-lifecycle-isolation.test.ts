import AsyncStorage from "@react-native-async-storage/async-storage";
import { waitFor } from "@testing-library/react-native";

import type { Moment, User } from "@/models";
import {
  cancelMomentUpload,
  enqueueMomentUpload,
  subscribeMomentUploads,
  type MomentUploadStatus,
} from "@/services/moments/MomentUploadQueue";
import { MomentUploadOwnerChangedError } from "@/services/moments/MomentBackgroundUpload";
import { deleteMoment } from "@/api/bwchat";
import { APIError } from "@/api/client";
import { publishMomentMutation } from "@/services/moments/MomentMutationStore";

let mockActiveOwnerId = "owner-a";
const mockCancelBackgroundUpload = jest.fn();
const mockClearBackgroundUploadCancellation = jest.fn();
const mockUploadMomentInBackground = jest.fn();

jest.mock("expo-file-system", () => ({
  Directory: class Directory {
    exists = true;
    uri = "file:///documents/mock";
    create() {}
    delete() {}
  },
  File: class File {},
  Paths: { document: "file:///documents" },
}));

jest.mock("@/api/bwchat", () => ({ deleteMoment: jest.fn() }));
jest.mock("@/services/cache/ImageCacheService", () => ({ adoptLocalImageFile: jest.fn() }));
jest.mock("@/services/cache/MediaCacheService", () => ({
  adoptLocalMediaFile: jest.fn(),
  chatVideoMediaCacheId: jest.fn((value: string) => value),
}));
jest.mock("@/services/moments/MomentMutationStore", () => ({
  publishMomentMutation: jest.fn(),
}));
jest.mock("@/storage/authStorage", () => ({
  readCachedUser: jest.fn(async () => ({ user_id: mockActiveOwnerId })),
}));
jest.mock("@/services/moments/MomentBackgroundUpload", () => {
  class OwnerChangedError extends Error {
    constructor() {
      super("owner changed");
      this.name = "MomentUploadOwnerChangedError";
    }
  }
  class ConfirmationUnknownError extends Error {}
  return {
    cancelMomentBackgroundUpload: (...args: unknown[]) => mockCancelBackgroundUpload(...args),
    clearMomentBackgroundUploadCancellation: (...args: unknown[]) =>
      mockClearBackgroundUploadCancellation(...args),
    MomentUploadConfirmationUnknownError: ConfirmationUnknownError,
    MomentUploadOwnerChangedError: OwnerChangedError,
    uploadMomentInBackground: (...args: unknown[]) => mockUploadMomentInBackground(...args),
  };
});

describe("CreateMoment upload lifecycle isolation", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    mockActiveOwnerId = "owner-a";
    await AsyncStorage.clear();
  });

  it("runs and cancels the same request id independently for two accounts", async () => {
    const requestId = "same-request-id";
    const ownerAUpload = deferred<Moment>();
    const ownerBUpload = deferred<Moment>();
    mockUploadMomentInBackground
      .mockImplementationOnce(() => ownerAUpload.promise)
      .mockImplementationOnce(() => ownerBUpload.promise);

    await enqueueMomentUpload({
      owner: user("owner-a"),
      clientRequestId: requestId,
      content: "A",
      media: [],
    });
    await waitFor(() => expect(mockUploadMomentInBackground).toHaveBeenCalledTimes(1));

    mockActiveOwnerId = "owner-b";
    await enqueueMomentUpload({
      owner: user("owner-b"),
      clientRequestId: requestId,
      content: "B",
      media: [],
    });
    await waitFor(() => expect(mockUploadMomentInBackground).toHaveBeenCalledTimes(2));

    await cancelMomentUpload(requestId);
    expect(mockCancelBackgroundUpload).toHaveBeenCalledWith("owner-b", requestId);

    ownerBUpload.resolve(moment(202, "owner-b", requestId));
    await waitFor(() => expect(deleteMoment).toHaveBeenCalledWith(202));

    mockActiveOwnerId = "owner-a";
    ownerAUpload.resolve(moment(101, "owner-a", requestId));
    await waitFor(() =>
      expect(publishMomentMutation).toHaveBeenCalledWith("owner-a", {
        kind: "created",
        moment: expect.objectContaining({ id: 101 }),
      }),
    );
    expect(publishMomentMutation).not.toHaveBeenCalledWith("owner-b", {
      kind: "created",
      moment: expect.objectContaining({ id: 202 }),
    });
    expect(mockClearBackgroundUploadCancellation).toHaveBeenCalledWith("owner-a", requestId);
    expect(mockClearBackgroundUploadCancellation).toHaveBeenCalledWith("owner-b", requestId);
  });

  it("restarts a parked A job after an A to B to A race without consuming an attempt", async () => {
    const requestId = "aba-request";
    const firstAttempt = deferred<Moment>();
    mockUploadMomentInBackground
      .mockImplementationOnce(() => firstAttempt.promise)
      .mockResolvedValueOnce(moment(303, "owner-a", requestId));
    const statuses: MomentUploadStatus[] = [];
    const unsubscribe = subscribeMomentUploads("owner-a", (status) => statuses.push(status));

    await enqueueMomentUpload({
      owner: user("owner-a"),
      clientRequestId: requestId,
      content: "ABA",
      media: [],
    });
    await waitFor(() => expect(mockUploadMomentInBackground).toHaveBeenCalledTimes(1));

    mockActiveOwnerId = "owner-b";
    firstAttempt.reject(new MomentUploadOwnerChangedError());
    mockActiveOwnerId = "owner-a";

    await waitFor(() => expect(mockUploadMomentInBackground).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(publishMomentMutation).toHaveBeenCalledWith("owner-a", {
        kind: "created",
        moment: expect.objectContaining({ id: 303 }),
      }),
    );
    expect(
      statuses
        .filter((status) => status.state === "preparing")
        .map((status) => status.attemptCount),
    ).toEqual([1, 1]);
    unsubscribe();
  });

  it("clears a cancellation marker immediately when a stopped job has no active task", async () => {
    const requestId = "stopped-request";
    mockUploadMomentInBackground.mockRejectedValueOnce(new APIError("bad request", 400));
    const statuses: MomentUploadStatus[] = [];
    const unsubscribe = subscribeMomentUploads("owner-a", (status) => statuses.push(status));

    await enqueueMomentUpload({
      owner: user("owner-a"),
      clientRequestId: requestId,
      content: "failed",
      media: [],
    });
    await waitFor(() => expect(statuses.at(-1)?.state).toBe("failed"));
    const clearsBeforeCancel = mockClearBackgroundUploadCancellation.mock.calls.length;

    await cancelMomentUpload(requestId);

    expect(mockClearBackgroundUploadCancellation).toHaveBeenCalledTimes(clearsBeforeCancel + 1);
    expect(mockClearBackgroundUploadCancellation).toHaveBeenLastCalledWith("owner-a", requestId);
    unsubscribe();
  });
});

function user(ownerId: string): User {
  return {
    user_id: ownerId,
    username: ownerId,
    nickname: ownerId,
    avatar_url: "",
    bio: "",
    gender: "",
    birthday: "",
    location: "",
    following_count: 0,
    follower_count: 0,
    followed_by_me: false,
    follows_me: false,
    is_friend: false,
  };
}

function moment(id: number, ownerId: string, requestId: string): Moment {
  return {
    id,
    author: { user_id: ownerId, nickname: ownerId, avatar_url: "" },
    content: ownerId,
    images: [],
    media: [],
    is_unlocked: true,
    created_at: "2026-08-08T00:00:00Z",
    likes: [],
    comments: [],
    liked_by_me: false,
    client_request_id: requestId,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, reject, resolve };
}
