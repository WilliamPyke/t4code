import type {
  EnvironmentId,
  ModelSelection,
  ProjectId,
  ProviderInstanceId,
  ScopedThreadRef,
} from "@t3tools/contracts";

import { type ComposerThreadDraftState, useComposerDraftStore } from "~/composerDraftStore";
import { useEnvironmentSettings } from "~/hooks/useSettings";
import {
  getCustomModelOptionsByInstance,
  resolveAppModelSelectionForInstance,
} from "~/modelSelection";
import { providerInstanceEntriesFor } from "~/providerInstances";
import { useQuietThreadShell } from "~/state/entities";
import { useEnvironmentProviders } from "~/state/environments";
import { EMPTY_SERVER_PROVIDERS } from "~/state/server";

import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { getDisplayModelName } from "../chat/providerIconUtils";
import { useApplyThreadModelPick } from "../chat/useApplyThreadModelPick";

/** The model a thread's composer has picked and not sent with yet, if any. */
export const composerDraftPick = (
  draft: ComposerThreadDraftState | null | undefined,
): ModelSelection | undefined =>
  draft?.activeProvider === null || draft?.activeProvider === undefined
    ? undefined
    : draft.modelSelectionByProvider[draft.activeProvider];

/** The selection the composer would make for a model picked from a list, with its remembered options. */
const pickedSelection = (instanceId: ProviderInstanceId, model: string): ModelSelection => {
  const remembered =
    useComposerDraftStore.getState().stickyOptionsByModelByProvider[instanceId]?.[model];
  return remembered !== undefined && remembered.length > 0
    ? { instanceId, model, options: [...remembered] }
    : { instanceId, model };
};

/**
 * The composer's model picker, compact, for a prompt box on the board. It shows `selection` and
 * hands back the composer's selection for a model picked from it.
 */
export function BoardModelPicker({
  environmentId,
  projectId,
  selection,
  onChange,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId | null;
  readonly selection: ModelSelection;
  readonly onChange: (selection: ModelSelection) => void;
}) {
  const providers = useEnvironmentProviders().get(environmentId) ?? EMPTY_SERVER_PROVIDERS;
  const settings = useEnvironmentSettings(environmentId);
  return (
    <ProviderModelPicker
      environmentId={environmentId}
      activeInstanceId={selection.instanceId}
      model={selection.model}
      lockedProvider={null}
      instanceEntries={providerInstanceEntriesFor(providers, settings, projectId)}
      modelOptionsByInstance={getCustomModelOptionsByInstance(
        settings,
        providers,
        selection.instanceId,
        selection.model,
      )}
      size="xs"
      compact
      popupAlign="start"
      onInstanceModelChange={(instanceId, model) => {
        const resolved = resolveAppModelSelectionForInstance(
          instanceId,
          settings,
          providers,
          model,
        );
        if (resolved !== null) onChange(pickedSelection(instanceId, resolved));
      }}
    />
  );
}

/**
 * The picker bound to a thread's composer draft, as its composer is: picking here is picking
 * there, and the thread takes the pick as the composer would have it take it.
 */
export function ThreadBoardModelPicker({
  threadRef,
  projectId,
  fallback,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly projectId: ProjectId | null;
  /** Shown until the thread's shell has loaded. */
  readonly fallback: ModelSelection | null;
}) {
  const picked = useComposerDraftStore((store) =>
    composerDraftPick(store.getComposerDraft(threadRef)),
  );
  const shell = useQuietThreadShell(threadRef);
  const applyThreadModelPick = useApplyThreadModelPick();
  const selection = picked ?? shell?.modelSelection ?? fallback;
  if (selection === null) return null;
  return (
    <BoardModelPicker
      environmentId={threadRef.environmentId}
      projectId={projectId}
      selection={selection}
      onChange={(next) => {
        const store = useComposerDraftStore.getState();
        store.setModelSelection(threadRef, next, { explicit: true, replaceOptions: true });
        store.setStickyModelSelection(next);
        void applyThreadModelPick(threadRef);
      }}
    />
  );
}

/** A model's name as the picker shows it, or its id when this environment does not list it. */
export function BoardModelName({
  environmentId,
  selection,
}: {
  readonly environmentId: EnvironmentId;
  readonly selection: ModelSelection;
}) {
  const providers = useEnvironmentProviders().get(environmentId) ?? EMPTY_SERVER_PROVIDERS;
  const model = providers
    .find((provider) => provider.instanceId === selection.instanceId)
    ?.models.find((candidate) => candidate.slug === selection.model);
  return <>{model === undefined ? selection.model : getDisplayModelName(model)}</>;
}

/** The model a thread's next turn runs on: its composer's unsent pick, else the thread's own. */
export function ThreadBoardModelName({
  threadRef,
  fallback,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly fallback: ModelSelection | null;
}) {
  const picked = useComposerDraftStore((store) =>
    composerDraftPick(store.getComposerDraft(threadRef)),
  );
  const shell = useQuietThreadShell(threadRef);
  const selection = picked ?? shell?.modelSelection ?? fallback;
  return selection === null ? null : (
    <BoardModelName environmentId={threadRef.environmentId} selection={selection} />
  );
}
