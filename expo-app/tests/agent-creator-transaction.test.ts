import type { AgentSummary } from "@/models";
import {
  executeAgentCreatorTransaction,
  type AgentCreatorTransactionCheckpoint,
  type AgentCreatorTransactionDependencies,
} from "@/services/agents/AgentCreatorTransaction";
import { defaultAgentCreatorValues } from "@/services/agents/agentCreatorPolicy";

const keys = {
  upload: "upload-key",
  create: "create-key",
  publish: "publish-key",
  conversation: "conversation-key",
};

describe("AgentCreator native save transaction", () => {
  it("runs prepare, upload, create, publish, install and best-effort conversation in order", async () => {
    const calls: string[] = [];
    let currentName = "上传前";
    const onAssetsUploaded = jest.fn();
    const disposePreparedReference = jest.fn();
    const dependencies = makeDependencies(calls);
    dependencies.prepareReference = jest.fn(async () => {
      calls.push("prepare");
      return "file:///prepared.jpg";
    });
    dependencies.uploadReference = jest.fn(async () => {
      calls.push("upload");
      currentName = "上传后的最新名称";
      return { primary_reference_asset_id: "reference-1", avatar_asset_id: "avatar-1" };
    });
    dependencies.disposePreparedReference = disposePreparedReference;

    const result = await executeAgentCreatorTransaction(
      {
        ownerId: "owner-1",
        currentAgent: null,
        selectedReference: { uri: "file:///picked.heic", width: 900, height: 1200 },
        idempotencyKeys: keys,
        currentValues: () => ({ ...defaultAgentCreatorValues, name: currentName }),
        onAssetsUploaded,
      },
      dependencies,
    );

    expect(calls).toEqual(["prepare", "upload", "create", "publish", "install", "conversation"]);
    expect(dependencies.prepareReference).toHaveBeenCalledWith("file:///picked.heic", 900, 1200);
    expect(dependencies.uploadReference).toHaveBeenCalledWith("file:///prepared.jpg", "upload-key");
    expect(dependencies.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "上传后的最新名称",
        primary_reference_asset_id: "reference-1",
        avatar_asset_id: "avatar-1",
      }),
      "create-key",
    );
    expect(dependencies.publish).toHaveBeenCalledWith("draft-1", "publish-key");
    expect(dependencies.install).toHaveBeenCalledWith("draft-1");
    expect(dependencies.createConversation).toHaveBeenCalledWith(
      "agent-1",
      "hello-1",
      "conversation-key",
    );
    expect(onAssetsUploaded).toHaveBeenCalledWith("reference-1", "avatar-1");
    expect(disposePreparedReference).toHaveBeenCalledWith("file:///prepared.jpg");
    expect(result).toMatchObject({
      installed: { id: "agent-1" },
      referenceAssetId: "reference-1",
      avatarAssetId: "avatar-1",
      createdNewAgent: true,
    });
  });

  it("cleans a generated upload file after failure but never deletes the selected preview", async () => {
    const generatedCalls: string[] = [];
    const generated = makeDependencies(generatedCalls);
    generated.prepareReference = jest.fn(async () => "file:///prepared.jpg");
    generated.uploadReference = jest.fn(async () => {
      throw new Error("upload failed");
    });
    generated.disposePreparedReference = jest.fn();
    await expect(
      executeAgentCreatorTransaction(
        {
          ownerId: "owner-1",
          currentAgent: null,
          selectedReference: { uri: "file:///selected-preview.jpg", width: 900, height: 1_200 },
          idempotencyKeys: keys,
          currentValues: () => ({ ...defaultAgentCreatorValues, name: "伙伴" }),
        },
        generated,
      ),
    ).rejects.toThrow("upload failed");
    expect(generated.disposePreparedReference).toHaveBeenCalledWith("file:///prepared.jpg");
    expect(generated.disposePreparedReference).not.toHaveBeenCalledWith(
      "file:///selected-preview.jpg",
    );

    const unchangedCalls: string[] = [];
    const unchanged = makeDependencies(unchangedCalls);
    unchanged.prepareReference = jest.fn(async (uri: string) => uri);
    unchanged.disposePreparedReference = jest.fn();
    await executeAgentCreatorTransaction(
      {
        ownerId: "owner-1",
        currentAgent: null,
        selectedReference: { uri: "file:///selected-preview.jpg", width: 900, height: 1_200 },
        idempotencyKeys: keys,
        currentValues: () => ({ ...defaultAgentCreatorValues, name: "伙伴" }),
      },
      unchanged,
    );
    expect(unchanged.disposePreparedReference).not.toHaveBeenCalled();
  });

  it("uses revision PATCH for edits and never creates an initial conversation", async () => {
    const calls: string[] = [];
    const dependencies = makeDependencies(calls);
    const currentAgent: AgentSummary = {
      id: "agent/edit",
      profile: { name: "原名" },
      primary_reference_asset_id: "existing-reference",
      avatar_asset_id: "existing-avatar",
    };
    const result = await executeAgentCreatorTransaction(
      {
        ownerId: "owner-1",
        currentAgent,
        selectedReference: null,
        referenceAssetId: "existing-reference",
        avatarAssetId: "existing-avatar",
        idempotencyKeys: keys,
        currentValues: () => ({ ...defaultAgentCreatorValues, name: "新名" }),
      },
      dependencies,
    );

    expect(calls).toEqual(["update", "publish", "install"]);
    expect(dependencies.update).toHaveBeenCalledWith(
      "agent/edit",
      0,
      expect.objectContaining({
        name: "新名",
        primary_reference_asset_id: "existing-reference",
        avatar_asset_id: "existing-avatar",
      }),
    );
    expect(dependencies.create).not.toHaveBeenCalled();
    expect(dependencies.createConversation).not.toHaveBeenCalled();
    expect(result.createdNewAgent).toBe(false);
  });

  it("keeps conversation creation best effort but stops the chain on publish/install failures", async () => {
    const bestEffortCalls: string[] = [];
    const bestEffort = makeDependencies(bestEffortCalls);
    bestEffort.createConversation = jest.fn(async () => {
      bestEffortCalls.push("conversation");
      throw new Error("conversation failed");
    });
    await expect(runCreate(bestEffort)).resolves.toMatchObject({ installed: { id: "agent-1" } });

    const publishCalls: string[] = [];
    const publishFailure = makeDependencies(publishCalls);
    publishFailure.publish = jest.fn(async () => {
      publishCalls.push("publish");
      throw new Error("publish failed");
    });
    await expect(runCreate(publishFailure)).rejects.toThrow("publish failed");
    expect(publishFailure.install).not.toHaveBeenCalled();

    const installCalls: string[] = [];
    const installFailure = makeDependencies(installCalls);
    installFailure.install = jest.fn(async () => {
      installCalls.push("install");
      throw new Error("install failed");
    });
    await expect(runCreate(installFailure)).rejects.toThrow("install failed");
    expect(installFailure.createConversation).not.toHaveBeenCalled();
  });

  it("fails closed before create when a new agent has no complete uploaded asset pair", async () => {
    const calls: string[] = [];
    const dependencies = makeDependencies(calls);
    await expect(
      executeAgentCreatorTransaction(
        {
          ownerId: "owner-1",
          currentAgent: null,
          selectedReference: null,
          referenceAssetId: "reference-only",
          idempotencyKeys: keys,
          currentValues: () => ({ ...defaultAgentCreatorValues, name: "伙伴" }),
        },
        dependencies,
      ),
    ).rejects.toThrow("请先选择符合要求的主参考图");
    expect(calls).toEqual([]);
  });

  it.each([
    ["prepare", { prepare: 2, upload: 1, create: 1, publish: 1, install: 1 }],
    ["upload", { prepare: 2, upload: 2, create: 1, publish: 1, install: 1 }],
    ["create", { prepare: 1, upload: 1, create: 2, publish: 1, install: 1 }],
    ["publish", { prepare: 1, upload: 1, create: 1, publish: 2, install: 1 }],
    ["install", { prepare: 1, upload: 1, create: 1, publish: 1, install: 2 }],
  ] as const)(
    "resumes after a %s failure without replaying completed steps",
    async (step, expected) => {
      const { dependencies, counts } = resumableDependencies(step);
      let checkpoint: AgentCreatorTransactionCheckpoint | null = null;
      const input = () => ({
        ownerId: "owner-1",
        currentAgent: null,
        selectedReference: { uri: "file:///picked.jpg", width: 900, height: 1200 },
        idempotencyKeys: keys,
        checkpoint,
        currentValues: () => ({ ...defaultAgentCreatorValues, name: "伙伴" }),
        onCheckpoint: (value: AgentCreatorTransactionCheckpoint) => {
          checkpoint = value;
        },
      });

      await expect(executeAgentCreatorTransaction(input(), dependencies)).rejects.toThrow(
        `${step} failed`,
      );
      await expect(executeAgentCreatorTransaction(input(), dependencies)).resolves.toMatchObject({
        installed: { id: "agent-1" },
      });

      expect(counts).toMatchObject(expected);
      expect(counts.conversation).toBe(1);
    },
  );

  it("resumes an edit update failure with its original owner, agent and revision", async () => {
    const { dependencies, counts } = resumableDependencies("update");
    const currentAgent: AgentSummary = {
      id: "agent-edit",
      revision: 7,
      profile: { name: "原名" },
      primary_reference_asset_id: "reference-1",
      avatar_asset_id: "avatar-1",
    };
    let checkpoint: AgentCreatorTransactionCheckpoint | null = null;
    const input = () => ({
      ownerId: "owner-1",
      currentAgent,
      selectedReference: null,
      referenceAssetId: "reference-1",
      avatarAssetId: "avatar-1",
      idempotencyKeys: keys,
      checkpoint,
      currentValues: () => ({ ...defaultAgentCreatorValues, name: "新名" }),
      onCheckpoint: (value: AgentCreatorTransactionCheckpoint) => {
        checkpoint = value;
      },
    });

    await expect(executeAgentCreatorTransaction(input(), dependencies)).rejects.toThrow(
      "update failed",
    );
    await executeAgentCreatorTransaction(input(), dependencies);
    expect(counts).toMatchObject({ update: 2, publish: 1, install: 1, conversation: 0 });
    expect(checkpoint).toMatchObject({
      ownerId: "owner-1",
      mode: "edit",
      sourceAgentId: "agent-edit",
      sourceRevision: 7,
    });
  });

  it("ignores checkpoints from another owner, target agent or base revision", async () => {
    const baseCheckpoint: AgentCreatorTransactionCheckpoint = {
      ownerId: "owner-1",
      mode: "edit",
      sourceAgentId: "agent-edit",
      sourceRevision: 7,
      referenceAssetId: "reference-1",
      avatarAssetId: "avatar-1",
      draft: { id: "draft-from-checkpoint", revision: 8, profile: { name: "新名" } },
      draftPayloadSignature: JSON.stringify({ impossible: true }),
      publishedDraftId: "draft-from-checkpoint",
    };

    for (const currentAgent of [
      { id: "agent-edit", revision: 7, ownerId: "owner-2" },
      { id: "another-agent", revision: 7, ownerId: "owner-1" },
      { id: "agent-edit", revision: 8, ownerId: "owner-1" },
    ]) {
      const calls: string[] = [];
      const dependencies = makeDependencies(calls);
      await executeAgentCreatorTransaction(
        {
          ownerId: currentAgent.ownerId,
          currentAgent: {
            id: currentAgent.id,
            revision: currentAgent.revision,
            profile: { name: "原名" },
          },
          selectedReference: null,
          idempotencyKeys: keys,
          checkpoint: baseCheckpoint,
          currentValues: () => ({ ...defaultAgentCreatorValues, name: "新名" }),
        },
        dependencies,
      );
      expect(calls).toEqual(["update", "publish", "install"]);
      expect(dependencies.update).toHaveBeenCalledWith(
        currentAgent.id,
        currentAgent.revision,
        expect.any(Object),
      );
    }
  });

  it("updates the already-created draft when fields change instead of creating a duplicate", async () => {
    const calls: string[] = [];
    const dependencies = makeDependencies(calls);
    let checkpoint: AgentCreatorTransactionCheckpoint | null = null;
    dependencies.publish = jest.fn(async () => {
      calls.push("publish");
      if (calls.filter((value) => value === "publish").length === 1) {
        throw new Error("publish failed");
      }
      return { id: "version-1" };
    });
    let name = "初始名称";
    const input = () => ({
      ownerId: "owner-1",
      currentAgent: null,
      selectedReference: null,
      referenceAssetId: "reference-1",
      avatarAssetId: "avatar-1",
      idempotencyKeys: keys,
      checkpoint,
      currentValues: () => ({ ...defaultAgentCreatorValues, name }),
      onCheckpoint: (value: AgentCreatorTransactionCheckpoint) => {
        checkpoint = value;
      },
    });

    await expect(executeAgentCreatorTransaction(input(), dependencies)).rejects.toThrow(
      "publish failed",
    );
    name = "重试前修改的名称";
    await executeAgentCreatorTransaction(input(), dependencies);

    expect(dependencies.create).toHaveBeenCalledTimes(1);
    expect(dependencies.update).toHaveBeenCalledTimes(1);
    expect(dependencies.update).toHaveBeenCalledWith(
      "draft-1",
      1,
      expect.objectContaining({ name: "重试前修改的名称" }),
    );
  });

  it("stops a stale account transaction after an in-flight step returns", async () => {
    const calls: string[] = [];
    const dependencies = makeDependencies(calls);
    let active = true;
    dependencies.uploadReference = jest.fn(async () => {
      calls.push("upload");
      active = false;
      return { primary_reference_asset_id: "old-reference", avatar_asset_id: "old-avatar" };
    });

    await expect(
      executeAgentCreatorTransaction(
        {
          ownerId: "old-owner",
          currentAgent: null,
          selectedReference: { uri: "file:///picked.jpg", width: 900, height: 1200 },
          idempotencyKeys: keys,
          currentValues: () => ({ ...defaultAgentCreatorValues, name: "伙伴" }),
          assertActive: () => {
            if (!active) throw new Error("stale account");
          },
        },
        dependencies,
      ),
    ).rejects.toThrow("stale account");
    expect(calls).toEqual(["upload"]);
    expect(dependencies.create).not.toHaveBeenCalled();
  });

  it("does not install twice after the installed checkpoint was recorded", async () => {
    const calls: string[] = [];
    const dependencies = makeDependencies(calls);
    let checkpoint: AgentCreatorTransactionCheckpoint | null = null;
    let assertionCount = 0;
    const firstInput = {
      ownerId: "owner-1",
      currentAgent: null,
      selectedReference: null,
      referenceAssetId: "reference-1",
      avatarAssetId: "avatar-1",
      idempotencyKeys: keys,
      currentValues: () => ({ ...defaultAgentCreatorValues, name: "伙伴" }),
      assertActive: () => {
        assertionCount += 1;
        if (assertionCount === 6) throw new Error("interrupted after install");
      },
      onCheckpoint: (value: AgentCreatorTransactionCheckpoint) => {
        checkpoint = value;
      },
    };
    await expect(executeAgentCreatorTransaction(firstInput, dependencies)).rejects.toThrow(
      "interrupted after install",
    );
    await executeAgentCreatorTransaction(
      {
        ownerId: firstInput.ownerId,
        currentAgent: firstInput.currentAgent,
        selectedReference: firstInput.selectedReference,
        referenceAssetId: firstInput.referenceAssetId,
        avatarAssetId: firstInput.avatarAssetId,
        idempotencyKeys: firstInput.idempotencyKeys,
        currentValues: firstInput.currentValues,
        onCheckpoint: firstInput.onCheckpoint,
        checkpoint,
      },
      dependencies,
    );

    expect(dependencies.create).toHaveBeenCalledTimes(1);
    expect(dependencies.publish).toHaveBeenCalledTimes(1);
    expect(dependencies.install).toHaveBeenCalledTimes(1);
    expect(dependencies.createConversation).toHaveBeenCalledTimes(1);
  });
});

function runCreate(dependencies: AgentCreatorTransactionDependencies) {
  return executeAgentCreatorTransaction(
    {
      ownerId: "owner-1",
      currentAgent: null,
      selectedReference: null,
      referenceAssetId: "reference-1",
      avatarAssetId: "avatar-1",
      idempotencyKeys: keys,
      currentValues: () => ({ ...defaultAgentCreatorValues, name: "伙伴" }),
    },
    dependencies,
  );
}

function makeDependencies(calls: string[]): AgentCreatorTransactionDependencies {
  return {
    prepareReference: jest.fn(async (uri: string) => uri),
    uploadReference: jest.fn(async () => ({
      primary_reference_asset_id: "reference-1",
      avatar_asset_id: "avatar-1",
    })),
    create: jest.fn(async () => {
      calls.push("create");
      return { id: "draft-1", revision: 1, profile: { name: "伙伴" } };
    }),
    update: jest.fn(async () => {
      calls.push("update");
      return { id: "draft-1", revision: 2, profile: { name: "伙伴" } };
    }),
    publish: jest.fn(async () => {
      calls.push("publish");
      return { id: "version-1" };
    }),
    install: jest.fn(async () => {
      calls.push("install");
      return {
        id: "agent-1",
        profile: { name: "伙伴" },
        greetings: [{ id: "hello-1", text: "你好" }],
      };
    }),
    createConversation: jest.fn(async () => {
      calls.push("conversation");
      return { id: "conversation-1" };
    }),
  };
}

function resumableDependencies(failOnceAt: string): {
  dependencies: AgentCreatorTransactionDependencies;
  counts: Record<string, number>;
} {
  const counts = {
    prepare: 0,
    upload: 0,
    create: 0,
    update: 0,
    publish: 0,
    install: 0,
    conversation: 0,
  };
  const run = async <Value>(step: keyof typeof counts, value: Value): Promise<Value> => {
    counts[step] += 1;
    if (step === failOnceAt && counts[step] === 1) throw new Error(`${step} failed`);
    return value;
  };
  return {
    counts,
    dependencies: {
      prepareReference: async () => run("prepare", "file:///prepared.jpg"),
      uploadReference: async () =>
        run("upload", {
          primary_reference_asset_id: "reference-1",
          avatar_asset_id: "avatar-1",
        }),
      create: async () => run("create", { id: "draft-1", revision: 1, profile: { name: "伙伴" } }),
      update: async () => run("update", { id: "draft-1", revision: 2, profile: { name: "伙伴" } }),
      publish: async () => run("publish", { id: "version-1" }),
      install: async () =>
        run("install", {
          id: "agent-1",
          profile: { name: "伙伴" },
          greetings: [{ id: "hello-1", text: "你好" }],
        }),
      createConversation: async () => run("conversation", { id: "conversation-1" }),
    },
  };
}
