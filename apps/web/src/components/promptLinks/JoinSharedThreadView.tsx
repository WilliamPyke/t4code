import { isGuestEnvironment, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  type EnvironmentId,
  GuestShareId,
  repositoryGroupingKeyOf,
  type RoomArtifactRead,
  type SharedThreadPreview,
  type ThreadId,
} from "@t3tools/contracts";
import { roomArtifactContextRecord } from "@t3tools/shared/composerContextReferences";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import type { JoinLink } from "@t3tools/shared/promptLinks";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";

import { isElectron } from "~/env";
import { findGuestShare, guestShareLocation, rememberGuestShare } from "~/guest/guestShares";
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

import { takeRoomArtifactToDraft } from "../chat/roomTaskDraft";
import { BoardBackdrop } from "../room/BoardChrome";
import { sortScopedProjectsForSidebar } from "../Sidebar.logic";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SidebarInset } from "../ui/sidebar";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { placeLinkedPrompt } from "./linkedPrompt";

type JoinState =
  // The link alone never makes this machine call the one it names.
  | { readonly status: "confirm" }
  | { readonly status: "working"; readonly title: string }
  | { readonly status: "ready"; readonly preview: SharedThreadPreview }
  | { readonly status: "failed"; readonly message: string };

const messageOf = (error: unknown, fallback: string) =>
  error instanceof Error && error.message ? error.message : fallback;

/**
 * Brings a thread someone shared to the user's own machine; every turn in it runs here. The
 * preview says before anything is created when the thread will show its turns to a room. A task
 * card's link lands as a draft in the thread joined from that room, joining first if needed, and
 * so does an artifact card's, with the card as the room has it attached.
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
  const takeSharedRoomTask = useAtomCommand(serverEnvironment.takeSharedRoomTask, {
    reportFailure: false,
  });
  const takeSharedRoomArtifact = useAtomCommand(serverEnvironment.takeSharedRoomArtifact, {
    reportFailure: false,
  });
  const [state, setState] = useState<JoinState>({ status: "confirm" });
  const source = { host: link.host, token: link.token };
  const task = link.task;
  const artifact = link.artifact;

  const openThread = (
    environmentId: EnvironmentId,
    threadId: ThreadId,
    taken: RoomArtifactRead | null = null,
  ) => {
    const threadRef = scopeThreadRef(environmentId, threadId);
    if (task !== undefined) {
      // A note from the board comes the same way, and answers nothing in the room.
      placeLinkedPrompt(threadRef, task.prompt, [
        "If this is a task card, your agent's reply answers it in the room.",
      ]);
    }
    if (artifact !== undefined && taken === null) {
      // A room on an older server names no share, so the card cannot be read from it.
      placeLinkedPrompt(threadRef, artifact.prompt, [
        "The room did not give the artifact, so the reply will not fill it.",
      ]);
    } else if (artifact !== undefined && taken !== null) {
      const record = roomArtifactContextRecord({
        batch: randomUUID(),
        shareId: GuestShareId.make(artifact.shareId),
        noteId: artifact.artifactId,
        title: taken.title,
        current: taken.body,
      });
      placeLinkedPrompt(
        threadRef,
        artifact.prompt,
        ["The artifact as it is now goes with it, and your agent's reply replaces it in the room."],
        () => takeRoomArtifactToDraft({ threadRef, record }),
      );
    }
    void navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId, threadId },
      replace: true,
    });
  };

  /** Has the thread joined from the task's room on this environment answer it next, if one is. */
  const takeTaskOn = async (environmentId: EnvironmentId): Promise<ThreadId | null> => {
    if (task === undefined) return null;
    const result = await takeSharedRoomTask({
      environmentId,
      input: { host: link.host, shareId: GuestShareId.make(task.shareId), taskId: task.taskId },
    });
    return result._tag === "Success" ? result.value.threadId : null;
  };

  /**
   * Opens the artifact's draft in the thread joined from its room on this environment, if one is,
   * with the card read from the room. Returns whether it did, after saying why it could not.
   */
  const takeArtifactOn = async (environmentId: EnvironmentId): Promise<boolean> => {
    if (artifact === undefined) return false;
    const result = await takeSharedRoomArtifact({
      environmentId,
      input: {
        host: link.host,
        shareId: GuestShareId.make(artifact.shareId),
        artifactId: artifact.artifactId,
      },
    });
    if (result._tag === "Failure") {
      if (isAtomCommandInterrupted(result)) return false;
      setState({
        status: "failed",
        message: messageOf(squashAtomCommandFailure(result), "Could not read the artifact."),
      });
      return true;
    }
    const { threadId, artifact: taken } = result.value;
    if (threadId === null) return false;
    if (taken === null) {
      setState({ status: "failed", message: "This artifact is no longer on the board." });
      return true;
    }
    openThread(environmentId, threadId, taken);
    return true;
  };

  /** Asks each of the user's own machines, the ones with projects; joins when none is in the room. */
  const takeToJoinedThread = async () => {
    setState({ status: "working", title: "Looking for your thread from this room..." });
    for (const environmentId of new Set(projects.map((project) => project.environmentId))) {
      if (artifact !== undefined) {
        if (await takeArtifactOn(environmentId)) return;
        continue;
      }
      const threadId = await takeTaskOn(environmentId);
      if (threadId !== null) return openThread(environmentId, threadId);
    }
    await loadPreview();
  };

  const lastActiveEnvironmentId = () => {
    let latest: (typeof threads)[number] | undefined;
    for (const thread of threads) {
      if (isGuestEnvironment(thread.environmentId)) continue;
      if (latest === undefined || thread.updatedAt > latest.updatedAt) latest = thread;
    }
    // A computer just connected with Tinkjam Sync has no threads yet.
    return (
      latest?.environmentId ??
      primaryEnvironmentId ??
      environments.find(
        (entry) =>
          !isGuestEnvironment(entry.environmentId) && entry.connection.phase === "connected",
      )?.environmentId ??
      null
    );
  };

  const loadPreview = async () => {
    const environmentId = lastActiveEnvironmentId();
    if (environmentId === null) {
      setState({ status: "failed", message: "Connect to one of your machines first." });
      return;
    }
    setState({
      status: "working",
      title: link.board === true ? "Asking for the board..." : "Asking for the thread...",
    });
    const result = await previewSharedThread({ environmentId, input: source });
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
        source,
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
    // The room itself comes too, so its board is in this app beside the joined thread.
    const { shared } = result.value;
    if (shared !== undefined && findGuestShare(shared.shareId) === null) {
      rememberGuestShare({
        host: link.host,
        shareId: shared.shareId,
        threadId: shared.threadId,
        token: shared.token,
        title: shared.title,
        joinedAt: new Date().toISOString(),
      });
    }
    // An artifact is read from the room the new thread just joined; it opens the thread itself.
    if (artifact !== undefined) {
      if (!(await takeArtifactOn(project.environmentId))) {
        openThread(project.environmentId, result.value.threadId);
      }
      return;
    }
    // Boards first: a plain join lands on the room's board; the joined thread is in the sidebar.
    if (task === undefined && shared !== undefined) {
      void navigate({ ...guestShareLocation({ ...shared, host: link.host }), replace: true });
      return;
    }
    // A room on an older server names no share, so its task cannot be taken: it stays a draft.
    await takeTaskOn(project.environmentId);
    openThread(project.environmentId, result.value.threadId);
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
      return artifact !== undefined ? (
        <JoinPage
          title="Take this artifact to your agent?"
          description={`"${artifact.prompt.text}" goes into your thread from this room as a draft, after you join it if you have not, with what the artifact shows now attached for your agent to revise. Nothing is sent until you send it. When your agent finishes, its reply replaces the artifact for everyone in the room.`}
        >
          <Button size="sm" onClick={() => void takeToJoinedThread()}>
            Continue
          </Button>
        </JoinPage>
      ) : link.board === true ? (
        <JoinPage
          title="Bring your agent to this board?"
          description={`Tinkjam will ask ${link.host} for the board. Your agent joins it from this computer, on your own provider sign-in.`}
        >
          <Button size="sm" onClick={() => void loadPreview()}>
            Continue
          </Button>
        </JoinPage>
      ) : task === undefined ? (
        <JoinPage
          title="Bring this shared thread to your machine?"
          description={`Tinkjam will ask ${link.host} for the conversation. You get your own thread: your turns run here, on your own provider login.`}
        >
          <Button size="sm" onClick={() => void loadPreview()}>
            Continue
          </Button>
        </JoinPage>
      ) : (
        <JoinPage
          title="Take this to your agent?"
          description={`"${task.prompt.text}" goes into your thread from this room as a draft, after you join it if you have not. Nothing is sent until you send it. If it is a task card, your agent's reply then answers it in the room.`}
        >
          <Button size="sm" onClick={() => void takeToJoinedThread()}>
            Continue
          </Button>
        </JoinPage>
      );
    case "working":
      return <JoinPage title={state.title} />;
    case "failed":
      return (
        <JoinPage
          title={link.board === true ? "Could not join the board" : "Could not join the thread"}
          description={state.message}
        />
      );
    case "ready": {
      const { preview } = state;
      if (preview.board === true && task === undefined && artifact === undefined) {
        return (
          <JoinBoardPage
            title={preview.title}
            projects={sortScopedProjectsForSidebar(
              projects.filter(
                (candidate) =>
                  candidate.isScratch !== true &&
                  candidate.archivedAt == null &&
                  !isGuestEnvironment(candidate.environmentId),
              ),
              threads,
              "updated_at",
            )}
            onJoin={(project) => {
              if (project === null) return void joinConversationOnly();
              setState({ status: "working", title: "Joining..." });
              void join(project, false);
            }}
          />
        );
      }
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
              ? "Everyone in the room sees each prompt you send in it as your agent starts on it, your agent's final reply when it finishes, and your thread's branch name and whether it is pushed; you can leave the room from the thread."
              : "Nothing you do in it is sent back."
          }${
            task !== undefined
              ? " Once you join, the task goes into the thread as a draft."
              : artifact !== undefined
                ? " Once you join, your request goes into the thread as a draft, with the artifact."
                : ""
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

const NO_PROJECT = "none";
const projectValue = (project: EnvironmentProject) => `${project.environmentId}:${project.id}`;

/** A cloud board: the person's agent joins it from here, in a project they pick or none. */
function JoinBoardPage({
  title,
  projects,
  onJoin,
}: {
  readonly title: string;
  readonly projects: ReadonlyArray<EnvironmentProject>;
  readonly onJoin: (project: EnvironmentProject | null) => void;
}) {
  const [value, setValue] = useState(() =>
    projects[0] === undefined ? NO_PROJECT : projectValue(projects[0]),
  );
  const items = [
    ...projects.map((project) => ({ value: projectValue(project), label: project.title })),
    { value: NO_PROJECT, label: "No project" },
  ];
  return (
    <JoinPage
      title={`Bring your agent to "${title}"?`}
      description="Your agent joins the board from this computer and runs here, on your own provider sign-in. Everyone on the board sees what it does. Pick the project it works in."
    >
      <Select
        value={value}
        onValueChange={(next) => {
          if (next) setValue(next);
        }}
        items={items}
      >
        <SelectTrigger aria-label="Project your agent works in">
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
      <Button
        size="sm"
        onClick={() => onJoin(projects.find((project) => projectValue(project) === value) ?? null)}
      >
        Join board
      </Button>
    </JoinPage>
  );
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
      <BoardBackdrop className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-10 scrollbar-gutter-both">
        <div className="m-auto flex w-full max-w-md flex-col gap-4 rounded-board border border-board-hairline bg-card p-6 text-card-foreground shadow-board">
          <div className="flex flex-col gap-1.5">
            <h1 className="text-lg font-semibold tracking-tight text-balance">{title}</h1>
            {description ? (
              <p className="text-sm text-pretty text-muted-foreground">{description}</p>
            ) : null}
          </div>
          {children ? <div className="flex flex-wrap justify-end gap-2">{children}</div> : null}
        </div>
      </BoardBackdrop>
    </SidebarInset>
  );
}
