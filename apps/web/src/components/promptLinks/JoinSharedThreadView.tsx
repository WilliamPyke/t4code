import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  repositoryGroupingKeyOf,
  type SharedThreadPreview,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import type { JoinLink } from "@t3tools/shared/promptLinks";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";

import { isElectron } from "~/env";
import { useScratchProject } from "~/hooks/useScratchProject";
import { randomUUID } from "~/lib/utils";
import { resolveProjectDefaultProviderModelSelection } from "~/providerInstances";
import { useProjects, useThreadShells } from "~/state/entities";
import {
  useEnvironmentProviders,
  useEnvironments,
  usePrimaryEnvironmentId,
} from "~/state/environments";
import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";

import { sortScopedProjectsForSidebar } from "../Sidebar.logic";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { SidebarInset } from "../ui/sidebar";
import { WorkspacePageHeader } from "../WorkspacePageHeader";

type JoinState =
  // The link alone never makes this machine call the one it names.
  | { readonly status: "confirm" }
  | { readonly status: "working"; readonly title: string }
  | { readonly status: "ready"; readonly preview: SharedThreadPreview }
  | { readonly status: "failed"; readonly message: string };

const messageOf = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

/**
 * Brings a thread someone shared to one of the user's own machines, as a thread of their own.
 * Every turn in it runs here, on the user's own provider login. When the owner's machine offers
 * a room, the thread shows its turns there, which the preview says before anything is created.
 */
export function JoinSharedThreadView({ link }: { readonly link: JoinLink }) {
  const navigate = useNavigate();
  const projects = useProjects();
  const threads = useThreadShells();
  const { environments } = useEnvironments();
  const providersByEnvironment = useEnvironmentProviders();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { scratchEnvironmentId, openScratchProject } = useScratchProject();
  const previewSharedThread = useAtomCommand(serverEnvironment.previewSharedThread, {
    reportFailure: false,
  });
  const joinSharedThread = useAtomCommand(serverEnvironment.joinSharedThread, {
    reportFailure: false,
  });
  const [state, setState] = useState<JoinState>({ status: "confirm" });

  const lastActiveEnvironmentId = () => {
    let latest: (typeof threads)[number] | undefined;
    for (const thread of threads) {
      if (latest === undefined || thread.updatedAt > latest.updatedAt) latest = thread;
    }
    return latest?.environmentId ?? primaryEnvironmentId;
  };

  const loadPreview = async () => {
    const environmentId = lastActiveEnvironmentId();
    if (environmentId === null) {
      setState({ status: "failed", message: "Connect to one of your machines first." });
      return;
    }
    setState({ status: "working", title: "Asking for the thread..." });
    const result = await previewSharedThread({ environmentId, input: link });
    if (result._tag === "Success") setState({ status: "ready", preview: result.value });
    else if (isAtomCommandInterrupted(result)) setState({ status: "confirm" });
    else {
      setState({
        status: "failed",
        message: messageOf(squashAtomCommandFailure(result), "Could not read the shared thread."),
      });
    }
  };

  const join = async (project: EnvironmentProject, checkout: boolean) => {
    const settings = environments.find((entry) => entry.environmentId === project.environmentId)
      ?.serverConfig?.settings;
    const providers = providersByEnvironment.get(project.environmentId) ?? [];
    const projectSettings =
      settings === undefined ? null : resolveProjectSettings(settings, project.id, project);
    const modelSelection =
      settings === undefined || projectSettings === null
        ? null
        : (projectSettings.settings.defaultModelSelection ??
          resolveProjectDefaultProviderModelSelection(providers, settings, project.id));
    if (projectSettings === null || modelSelection === null) {
      setState({ status: "failed", message: "Set up a provider on this machine first." });
      return;
    }
    const result = await joinSharedThread({
      environmentId: project.environmentId,
      input: {
        commandId: CommandId.make(randomUUID()),
        source: link,
        projectId: project.id,
        modelSelection,
        // The user's own defaults: a shared thread never brings its permissions along.
        runtimeMode: projectSettings.settings.defaultRuntimeMode,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        checkout,
      },
    });
    if (result._tag === "Failure") {
      if (isAtomCommandInterrupted(result)) return;
      setState({
        status: "failed",
        message: messageOf(squashAtomCommandFailure(result), "Could not join the thread."),
      });
      return;
    }
    void navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId: project.environmentId, threadId: result.value.threadId },
      replace: true,
    });
  };

  const joinWithCode = (project: EnvironmentProject) => {
    setState({ status: "working", title: "Joining..." });
    void join(project, true);
  };

  const joinConversationOnly = async () => {
    setState({ status: "working", title: "Joining..." });
    const environmentId = scratchEnvironmentId(lastActiveEnvironmentId());
    const project = environmentId === null ? null : await openScratchProject(environmentId);
    if (project === null) {
      setState({
        status: "failed",
        message: "None of your machines can start a thread without a project right now.",
      });
      return;
    }
    await join(project, false);
  };

  switch (state.status) {
    case "confirm":
      return (
        <JoinPage
          title="Bring this shared thread to your machine?"
          description={`T Code will ask ${link.host} for the conversation. You get your own thread: your turns run here, on your own provider login.`}
        >
          <Button size="sm" onClick={() => void loadPreview()}>
            Continue
          </Button>
        </JoinPage>
      );
    case "working":
      return <JoinPage title={state.title} />;
    case "failed":
      return <JoinPage title="Could not join the thread" description={state.message} />;
    case "ready": {
      const { preview } = state;
      const checkout = preview.checkout;
      // Most recently used first, so the user lands where they last worked on this repository.
      const project =
        checkout === null
          ? undefined
          : sortScopedProjectsForSidebar(
              projects.filter((candidate) => candidate.isScratch !== true),
              threads,
              "updated_at",
            ).find(
              (candidate) =>
                candidate.repositoryIdentity != null &&
                repositoryGroupingKeyOf(candidate.repositoryIdentity).toLowerCase() ===
                  checkout.repositoryKey.toLowerCase(),
            );
      const count = `${preview.messageCount} message${preview.messageCount === 1 ? "" : "s"}`;
      const code =
        checkout === null
          ? "It has no shared repository, so only the conversation comes over."
          : project === undefined
            ? `You do not have ${checkout.repositoryKey} on a connected machine, so only the conversation comes over.`
            : checkout.synced
              ? `With the code, you start from ${checkout.branch} in a new worktree, which runs your setup script.`
              : `With the code, you start from ${checkout.branch} as its remote has it, in a new worktree, which runs your setup script. Some of their work is not pushed yet.`;
      return (
        <JoinPage
          title={`Join "${preview.title}"?`}
          description={`${count}${preview.truncated ? " from the end of the thread" : ""} come with it. ${code} ${
            preview.live === true
              ? "Everyone in the room sees each prompt you send in it as your agent starts on it, and your agent's final reply when it finishes; you can leave the room from the thread."
              : "Nothing you do in it is sent back."
          }`}
        >
          {checkout !== null && project !== undefined ? (
            <Button size="sm" onClick={() => joinWithCode(project)}>
              Join with the code
            </Button>
          ) : null}
          <Button
            size="sm"
            variant={checkout !== null && project !== undefined ? "outline" : "default"}
            onClick={() => void joinConversationOnly()}
          >
            Conversation only
          </Button>
        </JoinPage>
      );
    }
  }
}

function JoinPage({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description?: string;
  readonly children?: ReactNode;
}) {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      {isElectron ? <WorkspacePageHeader electron /> : null}
      <Empty className="flex-1">
        <EmptyHeader className="max-w-md">
          <EmptyTitle>{title}</EmptyTitle>
          {description ? <EmptyDescription>{description}</EmptyDescription> : null}
          {children ? <div className="mt-5 flex justify-center gap-2">{children}</div> : null}
        </EmptyHeader>
      </Empty>
    </SidebarInset>
  );
}
