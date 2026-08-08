import AsyncStorage from "@react-native-async-storage/async-storage";

import { APIError } from "@/api/client";
import {
  createShortDramaSeries,
  submitShortDramaSeries,
  updateShortDramaEpisode,
  updateShortDramaSeries,
  uploadShortDramaEpisode,
} from "@/api/bwchat";
import type { ShortDramaCreator, ShortDramaSeries, ShortDramaVideo } from "@/models";
import {
  cancelShortDramaUpload,
  enqueueShortDramaPublish,
  readShortDramaUploadJobs,
  resumeShortDramaUploads,
  retryShortDramaUpload,
  subscribeShortDramaUploads,
  type ShortDramaUploadEvent,
} from "@/services/short-drama/ShortDramaUploadQueue";
import { ShortDramaUploadConfirmationUnknownError } from "@/services/short-drama/ShortDramaBackgroundUpload";
import type {
  ShortDramaEditorDraft,
  ShortDramaEpisodeDraft,
} from "@/services/short-drama/shortDramaEditorPolicy";
import { readCachedUser } from "@/storage/authStorage";

jest.mock("@/api/bwchat", () => ({
  createShortDramaSeries: jest.fn(),
  submitShortDramaSeries: jest.fn(),
  updateShortDramaEpisode: jest.fn(),
  updateShortDramaSeries: jest.fn(),
  uploadShortDramaEpisode: jest.fn(),
}));

jest.mock("@/services/short-drama/ShortDramaMediaService", () => ({
  removeShortDramaLocalFile: jest.fn(),
  shortDramaDraftDirectory: jest.fn(() => ({ exists: false })),
  shortDramaEpisodeCoverFilename: jest.fn(() => "episode-cover.jpg"),
  shortDramaEpisodeVideoFilename: jest.fn((uri: string) =>
    uri.endsWith(".mov") ? "episode.mov" : "episode.mp4",
  ),
}));

jest.mock("@/storage/authStorage", () => ({
  readCachedUser: jest.fn(),
}));

const createSeries = jest.mocked(createShortDramaSeries);
const updateSeries = jest.mocked(updateShortDramaSeries);
const uploadEpisode = jest.mocked(uploadShortDramaEpisode);
const patchEpisode = jest.mocked(updateShortDramaEpisode);
const submitSeries = jest.mocked(submitShortDramaSeries);
const cachedUser = jest.mocked(readCachedUser);

describe("native short-drama persistent publishing transaction", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await AsyncStorage.clear();
    cachedUser.mockResolvedValue({ user_id: "owner" } as never);
  });

  it("persists first, uploads new episodes at no more than two concurrently, then submits", async () => {
    cachedUser.mockResolvedValue({ user_id: "owner/a" } as never);
    createSeries.mockResolvedValue(series("server", []));
    let active = 0;
    let maximumActive = 0;
    uploadEpisode.mockImplementation(async (input) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await nextTask();
      active -= 1;
      return { video: video(input.clientEpisodeId, input.episodeNumber) };
    });
    submitSeries.mockResolvedValue(series("server", []));
    const submitted = waitForEvent((event) => event.kind === "submitted");
    const projection = await enqueueShortDramaPublish({
      ownerId: "owner/a",
      creator: creator(),
      draft: draft(undefined, 5),
      createdAt: "2026-08-07T00:00:00Z",
    });
    expect(projection).toMatchObject({ series_id: "local:draft", episode_count: 5 });
    expect((await readShortDramaUploadJobs("owner/a"))[0]).toMatchObject({
      id: "draft",
      state: expect.stringMatching(/queued|preparing|uploading/u),
    });
    await submitted;
    expect(maximumActive).toBe(2);
    expect(createSeries).toHaveBeenCalledWith({
      title: "剧名",
      intro: "简介",
      coverUri: "file:///cover.jpg",
      coverFilename: "cover.jpg",
    });
    expect(uploadEpisode).toHaveBeenCalledTimes(5);
    expect(submitSeries).toHaveBeenCalledWith("server", "draft");
    expect(await readShortDramaUploadJobs("owner/a")).toEqual([]);
  });

  it("patches dirty existing episodes before uploading drafts and skips clean server episodes", async () => {
    const clean = serverEpisode("clean", 1, false);
    const dirty = serverEpisode("dirty", 2, true);
    updateSeries.mockResolvedValue(series("server", [clean.server_video!, dirty.server_video!]));
    patchEpisode.mockResolvedValue(video("dirty", 2));
    uploadEpisode.mockResolvedValue({ video: video("new", 3) });
    submitSeries.mockResolvedValue(series("server", []));
    const submitted = waitForEvent((event) => event.kind === "submitted");
    await enqueueShortDramaPublish({
      ownerId: "owner",
      creator: creator(),
      draft: {
        ...draft(series("server"), 1),
        episodes: [clean, dirty, localEpisode("new", 3)],
      },
    });
    await submitted;
    expect(createSeries).not.toHaveBeenCalled();
    expect(updateSeries).toHaveBeenCalledWith("server", {
      title: "剧名",
      intro: "简介",
      coverUri: "file:///cover.jpg",
      coverFilename: "cover.jpg",
    });
    expect(patchEpisode).toHaveBeenCalledTimes(1);
    expect(patchEpisode).toHaveBeenCalledWith("dirty", {
      title: "服务端 dirty",
      intro: "",
      episodeNumber: 2,
      unlockPriceGoldCoins: 0,
    });
    expect(uploadEpisode).toHaveBeenCalledTimes(1);
  });

  it("retains a failed job with its server ID and manually resumes without recreating series", async () => {
    createSeries.mockResolvedValue(series("server", []));
    uploadEpisode.mockRejectedValueOnce(new Error("episode failed"));
    const failed = waitForEvent(
      (event) => event.kind === "updated" && event.job.state === "failed_permanent",
    );
    await enqueueShortDramaPublish({
      ownerId: "owner",
      creator: creator(),
      draft: draft(undefined, 1),
    });
    await failed;
    await nextTask();
    expect(await readShortDramaUploadJobs("other")).toEqual([]);
    expect((await readShortDramaUploadJobs("owner"))[0]).toMatchObject({
      id: "draft",
      server_id: "server",
      state: "failed_permanent",
      last_error: "one-or-more-episodes-failed",
      draft: { episodes: [{ upload_state: "failed", local_video_uri: "file:///episode-1.mp4" }] },
    });

    updateSeries.mockResolvedValue(series("server", []));
    uploadEpisode.mockResolvedValueOnce({ video: video("uploaded", 1) });
    submitSeries.mockResolvedValue(series("server", []));
    const submitted = waitForEvent((event) => event.kind === "submitted");
    await expect(retryShortDramaUpload("owner", "draft")).resolves.toBe(true);
    await submitted;
    expect(createSeries).toHaveBeenCalledTimes(1);
    expect(updateSeries).toHaveBeenCalledTimes(1);
    expect(submitSeries).toHaveBeenCalledWith("server", "draft");
    expect(await readShortDramaUploadJobs("owner")).toEqual([]);
  });

  it("persists transient failures as retry-waiting with a bounded next attempt", async () => {
    createSeries.mockResolvedValue(series("server", []));
    uploadEpisode.mockRejectedValue(new APIError("暂时失败", 503));
    const waiting = waitForEvent(
      (event) => event.kind === "updated" && event.job.state === "retry_waiting",
    );
    await enqueueShortDramaPublish({
      ownerId: "owner",
      creator: creator(),
      draft: draft(undefined, 1),
    });
    const event = await waiting;
    expect(event.job).toMatchObject({ attempt_count: 1, server_id: "server" });
    expect(event.job.next_attempt_at).toBeGreaterThan(Date.now());
    await cancelShortDramaUpload("owner", "draft");
  });

  it("keeps an ambiguous fully-sent result distinct from an ordinary permanent failure", async () => {
    createSeries.mockResolvedValue(series("server", []));
    uploadEpisode.mockRejectedValue(new ShortDramaUploadConfirmationUnknownError("待确认"));
    const unknown = waitForEvent(
      (event) => event.kind === "updated" && event.job.state === "confirmation_unknown",
    );
    await enqueueShortDramaPublish({
      ownerId: "owner",
      creator: creator(),
      draft: draft(undefined, 1),
    });
    await expect(unknown).resolves.toMatchObject({
      job: { attempt_count: 1, last_error: "待确认", server_id: "server" },
    });
    await cancelShortDramaUpload("owner", "draft");
  });

  it("parks an owner-changed job without consuming another account, then resumes for its owner", async () => {
    cachedUser.mockResolvedValue({ user_id: "other" } as never);
    await enqueueShortDramaPublish({
      ownerId: "owner",
      creator: creator(),
      draft: draft(undefined, 1),
    });
    await waitUntil(async () => {
      const job = (await readShortDramaUploadJobs("owner"))[0];
      return job?.state === "queued" && job.attempt_count === 0;
    });
    expect(createSeries).not.toHaveBeenCalled();

    cachedUser.mockResolvedValue({ user_id: "owner" } as never);
    createSeries.mockResolvedValue(series("server", []));
    uploadEpisode.mockResolvedValue({ video: video("uploaded", 1) });
    submitSeries.mockResolvedValue(series("server", []));
    const submitted = waitForEvent((event) => event.kind === "submitted");
    await resumeShortDramaUploads("owner", { awaitCompletion: true });
    await submitted;
    expect(createSeries).toHaveBeenCalledTimes(1);
    expect(await readShortDramaUploadJobs("other")).toEqual([]);
    expect(await readShortDramaUploadJobs("owner")).toEqual([]);
  });
});

function waitForEvent(
  predicate: (event: ShortDramaUploadEvent) => boolean,
): Promise<ShortDramaUploadEvent> {
  return new Promise((resolve) => {
    const unsubscribe = subscribeShortDramaUploads((event) => {
      if (!predicate(event)) return;
      unsubscribe();
      resolve(event);
    });
  });
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitUntil(predicate: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await predicate()) return;
    await nextTask();
  }
  throw new Error("condition not reached");
}

function draft(source: ShortDramaSeries | undefined, count: number): ShortDramaEditorDraft {
  return {
    draft_id: "draft",
    title: "剧名",
    intro: "简介",
    cover_uri: "file:///cover.jpg",
    ...(source ? { source_series: source } : {}),
    episodes: Array.from({ length: count }, (_, index) =>
      localEpisode(`episode-${index + 1}`, index + 1),
    ),
  };
}

function localEpisode(id: string, number: number): ShortDramaEpisodeDraft {
  return {
    id,
    episode_number: number,
    title: `第${number}集`,
    intro: "",
    unlock_price_gold_coins: 0,
    local_video_uri: `file:///${id}.mp4`,
    local_video_filename: `${id}.mp4`,
    local_video_mime_type: "video/mp4",
    preview_uri: `file:///${id}.jpg`,
    upload_state: "pending",
    is_dirty: false,
  };
}

function serverEpisode(id: string, number: number, dirty: boolean): ShortDramaEpisodeDraft {
  return {
    id: `local-${id}`,
    episode_number: number,
    title: `服务端 ${id}`,
    intro: "",
    unlock_price_gold_coins: 0,
    server_video: video(id, number),
    upload_state: dirty ? "failed" : "uploaded",
    is_dirty: dirty,
  };
}

function series(id: string, episodes: ShortDramaVideo[] = []): ShortDramaSeries {
  return {
    series_id: id,
    title: "剧名",
    intro: "简介",
    cover_url: "/cover.jpg",
    episode_count: episodes.length,
    status: "draft",
    updated_at: "",
    episodes,
    creator: creator(),
    resume_position_seconds: 0,
  };
}

function video(id: string, episodeNumber: number): ShortDramaVideo {
  return {
    id,
    drama_id: "server",
    creator: creator(),
    drama_title: "剧名",
    title: `第${episodeNumber}集`,
    intro: "",
    episode_number: episodeNumber,
    cover_url: "/episode.jpg",
    play_url: "/episode.mp4",
    playback_position_seconds: 0,
    like_count: 0,
    comment_count: 0,
    liked_by_me: false,
    is_unlocked: false,
    is_owned_by_current_user: true,
  };
}

function creator(): ShortDramaCreator {
  return {
    user_id: "owner",
    username: "owner",
    nickname: "作者",
    avatar_url: "",
    followed_by_me: false,
    follows_me: false,
    is_friend: false,
  };
}
