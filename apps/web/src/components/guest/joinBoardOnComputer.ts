import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  type EnvironmentId,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";

import { useScratchProject } from "~/hooks/useScratchProject";
import { randomUUID } from "~/lib/utils";
import { resolveProjectDefaultProviderModelSelection } from "~/providerInstances";
import { useEnvironmentProviders, useEnvironments } from "~/state/environments";
import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";

import { noAgentMessage, ownAgentFailureMessage } from "./bringAgent.logic";

/**
 * Joins a cloud board from one of the person's own computers, as the join page does, without
 * leaving the board: the agent's thread is made there, on that computer's own provider sign-in,
 * in `project` or in no project.
 */
export function useJoinBoardOnComputer() {
  const { environments } = useEnvironments();
  const providersByEnvironment = useEnvironmentProviders();
  const { openScratchProject } = useScratchProject();
  const joinSharedThread = useAtomCommand(serverEnvironment.joinSharedThread, {
    reportFailure: false,
  });
  /** Resolves to what went wrong, or null. */
  return async (input: {
    readonly environmentId: EnvironmentId;
    readonly project: EnvironmentProject | null;
    readonly source: { readonly host: string; readonly token: string };
  }): Promise<string | null> => {
    const computer = environments.find((entry) => entry.environmentId === input.environmentId);
    const settings = computer?.serverConfig?.settings;
    const providers = providersByEnvironment.get(input.environmentId) ?? [];
    const noAgent = () =>
      noAgentMessage({
        computerName: computer?.label ?? "your computer",
        settingsLoaded: settings !== undefined,
        providers,
      });
    if (settings === undefined || providers.length === 0) return noAgent();
    const project =
      input.project ??
      (await openScratchProject(input.environmentId, "Could not start your agent"));
    if (project === null) return "Your computer could not start your agent. Try again.";
    const projectSettings = resolveProjectSettings(settings, project.id, project);
    const modelSelection =
      projectSettings.settings.defaultModelSelection ??
      resolveProjectDefaultProviderModelSelection(providers, settings, project.id);
    if (modelSelection === null) return noAgent();
    const result = await joinSharedThread({
      environmentId: input.environmentId,
      input: {
        commandId: CommandId.make(randomUUID()),
        source: input.source,
        projectId: project.id,
        modelSelection,
        // The person's own defaults: a board never brings permissions along.
        runtimeMode: projectSettings.settings.defaultRuntimeMode,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        checkout: false,
      },
    });
    if (result._tag === "Success") return null;
    if (isAtomCommandInterrupted(result)) return "Stopped before your agent joined.";
    return ownAgentFailureMessage(
      squashAtomCommandFailure(result),
      `${computer?.label ?? "Your computer"} could not bring your agent. Check that Tinkjam Sync is running on it, then try again.`,
    );
  };
}
