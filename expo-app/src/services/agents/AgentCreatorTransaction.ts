import {
  createAgent,
  createAgentConversation,
  installAgent,
  publishAgent,
  updateAgentDraft,
  uploadAgentReference,
} from "@/api/bwchat";
import type { AgentSummary } from "@/models";
import {
  agentPatchPayload,
  createAgentPayload,
  prepareAgentReferenceForUpload,
  removeAgentCreatorTemporaryFile,
  type AgentCreatorValues,
} from "@/services/agents/agentCreatorPolicy";

export interface AgentCreatorSelectedReference {
  uri: string;
  width: number;
  height: number;
}

export interface AgentCreatorIdempotencyKeys {
  upload: string;
  create: string;
  publish: string;
  conversation: string;
}

export interface AgentCreatorTransactionInput {
  ownerId: string;
  currentAgent: AgentSummary | null;
  selectedReference: AgentCreatorSelectedReference | null;
  referenceAssetId?: string | undefined;
  avatarAssetId?: string | undefined;
  idempotencyKeys: AgentCreatorIdempotencyKeys;
  checkpoint?: AgentCreatorTransactionCheckpoint | null | undefined;
  currentValues(): AgentCreatorValues;
  assertActive?(): void;
  onAssetsUploaded?(referenceAssetId: string, avatarAssetId: string): void;
  onCheckpoint?(checkpoint: AgentCreatorTransactionCheckpoint): void;
}

export interface AgentCreatorTransactionResult {
  installed: AgentSummary;
  referenceAssetId?: string | undefined;
  avatarAssetId?: string | undefined;
  createdNewAgent: boolean;
}

export interface AgentCreatorTransactionCheckpoint {
  ownerId: string;
  mode: "create" | "edit";
  sourceAgentId?: string | undefined;
  sourceRevision?: number | undefined;
  selectedReferenceUri?: string | undefined;
  referenceAssetId?: string | undefined;
  avatarAssetId?: string | undefined;
  draft?: AgentSummary | undefined;
  draftPayloadSignature?: string | undefined;
  publishedDraftId?: string | undefined;
  installedDraftId?: string | undefined;
  installed?: AgentSummary | undefined;
}

export interface AgentCreatorTransactionDependencies {
  prepareReference(uri: string, width: number, height: number): Promise<string>;
  uploadReference(
    uri: string,
    idempotencyKey: string,
  ): Promise<{
    primary_reference_asset_id: string;
    avatar_asset_id: string;
  }>;
  create(payload: Record<string, unknown>, idempotencyKey: string): Promise<AgentSummary>;
  update(
    agentId: string,
    expectedRevision: number,
    patch: Record<string, unknown>,
  ): Promise<AgentSummary>;
  publish(agentId: string, idempotencyKey: string): Promise<unknown>;
  install(agentId: string): Promise<AgentSummary>;
  createConversation(agentId: string, greetingId: string, idempotencyKey: string): Promise<unknown>;
  disposePreparedReference?(uri: string): void;
}

const defaultDependencies: AgentCreatorTransactionDependencies = {
  prepareReference: prepareAgentReferenceForUpload,
  uploadReference: uploadAgentReference,
  create: createAgent,
  update: updateAgentDraft,
  publish: publishAgent,
  install: installAgent,
  createConversation: createAgentConversation,
  disposePreparedReference: removeAgentCreatorTemporaryFile,
};

export async function executeAgentCreatorTransaction(
  input: AgentCreatorTransactionInput,
  dependencies: AgentCreatorTransactionDependencies = defaultDependencies,
): Promise<AgentCreatorTransactionResult> {
  if (!input.ownerId.trim()) throw new Error("登录会话已失效");
  const createdNewAgent = input.currentAgent === null;
  const mode = createdNewAgent ? "create" : "edit";
  const sourceAgentId = input.currentAgent?.id;
  const sourceRevision = input.currentAgent?.revision ?? (createdNewAgent ? undefined : 0);
  let checkpoint = matchingCheckpoint(
    input.checkpoint,
    input.ownerId,
    mode,
    sourceAgentId,
    sourceRevision,
  );
  let referenceAssetId = input.referenceAssetId;
  let avatarAssetId = input.avatarAssetId;

  if (input.selectedReference) {
    if (
      checkpoint?.selectedReferenceUri === input.selectedReference.uri &&
      checkpoint.referenceAssetId &&
      checkpoint.avatarAssetId
    ) {
      referenceAssetId = checkpoint.referenceAssetId;
      avatarAssetId = checkpoint.avatarAssetId;
    } else {
      assertActive(input);
      const preparedUri = await dependencies.prepareReference(
        input.selectedReference.uri,
        input.selectedReference.width,
        input.selectedReference.height,
      );
      let uploaded: Awaited<ReturnType<AgentCreatorTransactionDependencies["uploadReference"]>>;
      try {
        assertActive(input);
        uploaded = await dependencies.uploadReference(preparedUri, input.idempotencyKeys.upload);
      } finally {
        if (preparedUri !== input.selectedReference.uri) {
          dependencies.disposePreparedReference?.(preparedUri);
        }
      }
      assertActive(input);
      referenceAssetId = uploaded.primary_reference_asset_id;
      avatarAssetId = uploaded.avatar_asset_id;
      checkpoint = {
        ...checkpoint,
        ownerId: input.ownerId,
        mode,
        ...(sourceAgentId ? { sourceAgentId } : {}),
        ...(sourceRevision !== undefined ? { sourceRevision } : {}),
        selectedReferenceUri: input.selectedReference.uri,
        referenceAssetId,
        avatarAssetId,
      };
      input.onAssetsUploaded?.(referenceAssetId, avatarAssetId);
      emitCheckpoint(input, checkpoint);
    }
  }

  // The native Form remains editable while an upload is running. Read the
  // values after upload preparation so the draft uses the same latest fields.
  const values = input.currentValues();
  const patch = agentPatchPayload(values, { referenceAssetId, avatarAssetId });
  const draftPayloadSignature = JSON.stringify(patch);
  let draft: AgentSummary;
  if (checkpoint?.draft && checkpoint.draftPayloadSignature === draftPayloadSignature) {
    draft = checkpoint.draft;
  } else if (checkpoint?.draft) {
    assertActive(input);
    draft = await dependencies.update(checkpoint.draft.id, checkpoint.draft.revision ?? 0, patch);
    assertActive(input);
  } else if (input.currentAgent) {
    assertActive(input);
    draft = await dependencies.update(
      input.currentAgent.id,
      input.currentAgent.revision ?? 0,
      patch,
    );
    assertActive(input);
  } else {
    if (!referenceAssetId || !avatarAssetId) {
      throw new Error("请先选择主参考图");
    }
    assertActive(input);
    draft = await dependencies.create(
      createAgentPayload(values, referenceAssetId, avatarAssetId),
      input.idempotencyKeys.create,
    );
    assertActive(input);
  }

  if (checkpoint?.draft !== draft || checkpoint.draftPayloadSignature !== draftPayloadSignature) {
    checkpoint = {
      ownerId: input.ownerId,
      mode,
      ...(sourceAgentId ? { sourceAgentId } : {}),
      ...(sourceRevision !== undefined ? { sourceRevision } : {}),
      ...(input.selectedReference ? { selectedReferenceUri: input.selectedReference.uri } : {}),
      ...(referenceAssetId ? { referenceAssetId } : {}),
      ...(avatarAssetId ? { avatarAssetId } : {}),
      draft,
      draftPayloadSignature,
    };
    emitCheckpoint(input, checkpoint);
  }

  if (checkpoint.publishedDraftId !== draft.id) {
    assertActive(input);
    await dependencies.publish(draft.id, input.idempotencyKeys.publish);
    assertActive(input);
    checkpoint = { ...checkpoint, publishedDraftId: draft.id };
    emitCheckpoint(input, checkpoint);
  }

  let installed: AgentSummary;
  if (checkpoint.installedDraftId === draft.id && checkpoint.installed) {
    installed = checkpoint.installed;
  } else {
    assertActive(input);
    installed = await dependencies.install(draft.id);
    checkpoint = {
      ...checkpoint,
      installedDraftId: draft.id,
      installed,
    };
    emitCheckpoint(input, checkpoint);
    assertActive(input);
  }
  if (createdNewAgent) {
    try {
      assertActive(input);
      await dependencies.createConversation(
        installed.id,
        installed.greetings?.[0]?.id ?? "default",
        input.idempotencyKeys.conversation,
      );
      assertActive(input);
    } catch {
      // Native intentionally treats initial-conversation creation as best effort.
      // A route/account change is not a conversation failure and must still
      // stop the old transaction from mutating the newly active screen.
      assertActive(input);
    }
  }

  return { installed, referenceAssetId, avatarAssetId, createdNewAgent };
}

function matchingCheckpoint(
  checkpoint: AgentCreatorTransactionCheckpoint | null | undefined,
  ownerId: string,
  mode: AgentCreatorTransactionCheckpoint["mode"],
  sourceAgentId: string | undefined,
  sourceRevision: number | undefined,
): AgentCreatorTransactionCheckpoint | undefined {
  if (!checkpoint || checkpoint.ownerId !== ownerId || checkpoint.mode !== mode) return undefined;
  if (
    mode === "edit" &&
    (checkpoint.sourceAgentId !== sourceAgentId || checkpoint.sourceRevision !== sourceRevision)
  ) {
    return undefined;
  }
  return checkpoint;
}

function assertActive(input: AgentCreatorTransactionInput): void {
  input.assertActive?.();
}

function emitCheckpoint(
  input: AgentCreatorTransactionInput,
  checkpoint: AgentCreatorTransactionCheckpoint,
): void {
  input.onCheckpoint?.({ ...checkpoint });
}
