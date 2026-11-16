import { useAtomValue } from "@effect/atom-react";
import {
  guestEnvironmentId,
  isGuestEnvironment,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  AuthOrchestrationOperateScope,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  GUEST_NAME_MAX_LENGTH,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { Atom } from "effect/reactivity";
import { CloudIcon } from "lucide-react";
import { type FormEvent, useEffect, useEffectEvent, useState } from "react";

import { isCommandPaletteOpen, openCommandPalette } from "~/commandPaletteBus";
import {
  createCloudBoard,
  putOnCloudBoard,
  readBoardName,
  rememberBoardName,
} from "~/guest/cloudBoards";
import { cloudBoardsOrigin } from "~/guest/cloudBoardsHost";
import { rememberGuestShare } from "~/guest/guestShares";
import { getLocalStorageItem, setLocalStorageItem } from "~/hooks/useLocalStorage";
import { useScratchProject } from "~/hooks/useScratchProject";
import { registerCommands } from "~/shortcuts/dispatcher";
import { newThreadId, randomUUID } from "~/lib/utils";
import { resolveProjectDefaultProviderModelSelection } from "~/providerInstances";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useProjects, useThreadShells } from "~/state/entities";
import {
  readGuestOnly,
  useEnvironmentProviders,
  useEnvironments,
  usePrimaryEnvironmentId,
} from "~/state/environments";
import { serverEnvironment } from "~/state/server";
import { useEnvironmentsWithScope } from "~/state/session";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";

import { sortScopedProjectsForSidebar } from "../Sidebar.logic";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { BoardThumbnail } from "./BoardThumbnail";
import { fitRoomBoardOnOpen, roomBoardViewKey } from "../room/roomBoardNavigation";
import { nameBoardOnOpen } from "./BoardTitle";
import {
  BLANK_BOARD_TEMPLATE,
  BOARD_TEMPLATES,
  type BoardTemplate,
  boardTemplateChanges,
  boardTemplateShapes,
  cloudBoardTemplateChanges,
} from "./boardTemplates";
import {
  UNTITLED_BOARD,
  listHomeBoards,
  newBoardProjectKey,
  newBoardStart,
} from "./boardsHome.logic";

// Per device: the project the last new board went in, so the next one goes there without asking.
const LAST_PROJECT_KEY = "t3code:new-board-project:v1";
const LastProject = Schema.String;

const readLastProject = () => {
  try {
    return getLocalStorageItem(LAST_PROJECT_KEY, LastProject);
  } catch {
    return null;
  }
};

const rememberLastProject = (project: EnvironmentProject) => {
  try {
    setLocalStorageItem(LAST_PROJECT_KEY, newBoardProjectKey(project), LastProject);
  } catch {
    // Storage that is full or blocked only loses the default.
  }
};

// The template a board waits to be made with while the user picks its project.
const pickerOpenAtom = Atom.make<BoardTemplate | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("boards:new-board-picker"),
);
const closePicker = () => appAtomRegistry.set(pickerOpenAtom, null);

const templatesOpenAtom = Atom.make(false).pipe(
  Atom.keepAlive,
  Atom.withLabel("boards:new-board-templates"),
);
/** Opens the choice of what a new board starts with. */
export const openBoardTemplates = () => appAtomRegistry.set(templatesOpenAtom, true);
const closeTemplates = () => appAtomRegistry.set(templatesOpenAtom, false);

// The template a cloud board waits to be made with while the user says their name.
const cloudNameAtom = Atom.make<BoardTemplate | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("boards:cloud-board-name"),
);
const closeCloudName = () => appAtomRegistry.set(cloudNameAtom, null);

/** Whether this build has a cloud board host to make boards on. */
const hasCloudBoards = () => cloudBoardsOrigin() !== null;
const fitsCloud = (template: BoardTemplate) =>
  cloudBoardTemplateChanges(template, () => "") !== null;

/** The machines this browser may make a board on now: connected, and allowed to. */
function useOperableEnvironments() {
  const { environments } = useEnvironments();
  return useEnvironmentsWithScope(
    environments.filter((entry) => !isGuestEnvironment(entry.environmentId)),
    AuthOrchestrationOperateScope,
  );
}

/** Where a board opens right after it is made: full size, no conversation beside it. */
const newBoardLocation = (ref: ScopedThreadRef) => ({
  to: "/board/$roomEnvironmentId/$roomThreadId" as const,
  params: { roomEnvironmentId: ref.environmentId, roomThreadId: ref.threadId },
  search: {},
});

/**
 * Makes a board in a project: a thread underneath, with the user's own defaults, whose board is
 * kept from the start so it is listed even before anything is on it. Opens it once made.
 */
function useCreateBoard() {
  const navigate = useNavigate();
  const { environments } = useEnvironments();
  const providersByEnvironment = useEnvironmentProviders();
  const createThread = useOrchestrationCommand(threadEnvironment.create, {
    reportFailure: false,
  });
  const changeBoard = useAtomCommand(serverEnvironment.changeGuestBoard, {
    reportFailure: false,
  });
  return async (
    project: EnvironmentProject,
    template: BoardTemplate = BLANK_BOARD_TEMPLATE,
  ): Promise<boolean> => {
    const settings = environments.find((entry) => entry.environmentId === project.environmentId)
      ?.serverConfig?.settings;
    const projectSettings =
      settings === undefined ? null : resolveProjectSettings(settings, project.id, project);
    const modelSelection =
      settings === undefined || projectSettings === null
        ? null
        : (projectSettings.settings.defaultModelSelection ??
          resolveProjectDefaultProviderModelSelection(
            providersByEnvironment.get(project.environmentId) ?? [],
            settings,
            project.id,
          ));
    if (projectSettings === null || modelSelection === null) {
      toastManager.add({
        type: "error",
        title: "Could not start a board",
        description: "Set up a provider on this machine first.",
      });
      return false;
    }
    const threadId = newThreadId();
    const created = await createThread({
      environmentId: project.environmentId,
      input: {
        threadId,
        projectId: project.id,
        title: UNTITLED_BOARD,
        modelSelection,
        runtimeMode: projectSettings.settings.defaultRuntimeMode,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        branch: null,
        worktreePath: null,
      },
    });
    if (created._tag === "Failure") {
      if (!isAtomCommandInterrupted(created)) {
        const error = squashAtomCommandFailure(created);
        toastManager.add({
          type: "error",
          title: "Could not start a board",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      }
      return false;
    }
    // An unshared board with nothing on it is not kept; placing the thread's own card, which
    // every template does first, keeps it. One at a time: a line waits for the cards it joins.
    let notes = 0;
    for (const change of boardTemplateChanges(template, randomUUID)) {
      const changed = await changeBoard({
        environmentId: project.environmentId,
        input: { threadId, change },
      });
      if (changed._tag === "Failure") {
        toastManager.add({
          type: "error",
          title: "Some of the template is missing",
          description: "The board was made, but not all of its cards could be added.",
        });
        break;
      }
      if (change.type === "note.put") notes += 1;
    }
    rememberLastProject(project);
    const ref = scopeThreadRef(project.environmentId, threadId);
    // A template's board opens showing all of it, once its cards reach this page.
    if (notes > 0) fitRoomBoardOnOpen(roomBoardViewKey(ref), notes);
    // Typing on a new board names it; it never reaches a prompt the user has not clicked into.
    nameBoardOnOpen(ref);
    void navigate(newBoardLocation(ref));
    return true;
  };
}

/**
 * Makes a board on the cloud host, on nobody's machine, as the name this browser joins boards
 * under, asking for it first when there is none. Opens it once made.
 */
function useCreateCloudBoard() {
  const navigate = useNavigate();
  return async (
    template: BoardTemplate = BLANK_BOARD_TEMPLATE,
    name: string | null = readBoardName(),
  ): Promise<boolean> => {
    const changes = cloudBoardTemplateChanges(template, randomUUID);
    if (changes === null) {
      toastManager.add({
        type: "error",
        title: "Could not start a board",
        description: "This template needs an agent, which a cloud board does not have yet.",
      });
      return false;
    }
    if (name === null) {
      appAtomRegistry.set(cloudNameAtom, template);
      return false;
    }
    const created = await createCloudBoard({ name, title: UNTITLED_BOARD });
    if (typeof created === "string") {
      toastManager.add({ type: "error", title: "Could not start a board", description: created });
      return false;
    }
    rememberGuestShare(created);
    if (!(await putOnCloudBoard(created, changes))) {
      toastManager.add({
        type: "error",
        title: "Some of the template is missing",
        description: "The board was made, but not all of its cards could be added.",
      });
    }
    const ref = scopeThreadRef(guestEnvironmentId(created.shareId), created.threadId);
    const notes = changes.filter((change) => change.type === "note.put").length;
    if (notes > 0) fitRoomBoardOnOpen(`guest:${created.shareId}`, notes);
    nameBoardOnOpen(ref);
    void navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId: ref.environmentId, threadId: ref.threadId },
    });
    return true;
  };
}

/**
 * Starts a new board with the fewest questions: straight into the project it would obviously go
 * in, a conversation-only project when there is none, and a project picker otherwise.
 */
export function useStartNewBoard() {
  const projects = useProjects();
  const threads = useThreadShells();
  const createBoard = useCreateBoard();
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const { scratchEnvironmentId, openScratchProject } = useScratchProject();
  const operable = useOperableEnvironments();
  const createCloudBoard = useCreateCloudBoard();
  return async (template: BoardTemplate = BLANK_BOARD_TEMPLATE) => {
    const decision = newBoardStart({
      projects,
      boards: listHomeBoards({ threads, joined: [], teams: [], isOwnEnvironment: () => true }),
      lastUsed: readLastProject(),
      operable,
      cloud: hasCloudBoards(),
    });
    if (decision.kind === "cloud") {
      await createCloudBoard(template);
      return;
    }
    if (decision.kind === "use") {
      await createBoard(decision.project, template);
      return;
    }
    if (decision.kind === "ask") {
      appAtomRegistry.set(pickerOpenAtom, template);
      return;
    }
    const environmentId = scratchEnvironmentId(primaryEnvironmentId);
    const scratch =
      environmentId === null
        ? null
        : await openScratchProject(environmentId, "Could not start a board");
    if (scratch !== null) {
      await createBoard(scratch, template);
      return;
    }
    openCommandPalette({ open: "add-project" });
  };
}

/** Hosted once at the root, so every New board can ask which project when it has to. */
export function NewBoardDialogHost() {
  const pending = useAtomValue(pickerOpenAtom);
  const templatesOpen = useAtomValue(templatesOpenAtom);
  const naming = useAtomValue(cloudNameAtom);
  return (
    <>
      <BoardShortcuts />
      {templatesOpen ? <NewBoardTemplatePicker /> : null}
      {pending === null ? null : <NewBoardProjectPicker template={pending} />}
      {naming === null ? null : <CloudBoardNameDialog template={naming} />}
    </>
  );
}

/** Go to Boards and New board from the keyboard, wherever the app is. */
function BoardShortcuts() {
  const navigate = useNavigate();
  const startNewBoard = useStartNewBoard();
  const goToBoards = useEffectEvent(() => void navigate({ to: "/" }));
  const newBoard = useEffectEvent(() => void startNewBoard());
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- registers the board shortcuts with the global keydown dispatcher
  useEffect(
    () =>
      registerCommands(
        {
          "boards.open": (event) => {
            event.preventDefault();
            if (!event.repeat) goToBoards();
          },
          "boards.new": (event) => {
            // A browser that only joined guest links has nowhere to make a board but the cloud.
            if (readGuestOnly() && !hasCloudBoards()) return false;
            event.preventDefault();
            if (!event.repeat) newBoard();
          },
        },
        { when: () => !isCommandPaletteOpen() },
      ),
    [],
  );
  return null;
}

function NewBoardProjectPicker({ template }: { readonly template: BoardTemplate }) {
  const projects = useProjects();
  const threads = useThreadShells();
  const createBoard = useCreateBoard();
  const createCloudBoard = useCreateCloudBoard();
  const operable = useOperableEnvironments();
  const [pending, setPending] = useState(false);
  const cloud = hasCloudBoards() && fitsCloud(template);
  // Most recently used first, of the machines that can take a board now.
  const choices = sortScopedProjectsForSidebar(
    projects.filter((project) => project.archivedAt == null && operable.has(project.environmentId)),
    threads,
    "updated_at",
  );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) closePicker();
      }}
    >
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>New board</DialogTitle>
          <DialogDescription>
            Pick the project its agents work in. Next time it goes there without asking.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <ul className="flex flex-col gap-1" data-new-board-projects>
            {choices.map((project) => (
              <li key={newBoardProjectKey(project)}>
                <Button
                  variant="ghost"
                  className="w-full justify-start"
                  disabled={pending}
                  onClick={async () => {
                    setPending(true);
                    const made = await createBoard(project, template);
                    setPending(false);
                    if (made) closePicker();
                  }}
                >
                  <span className="min-w-0 truncate">{project.title}</span>
                </Button>
              </li>
            ))}
            {cloud ? (
              <li>
                <Button
                  variant="ghost"
                  className="w-full justify-start"
                  disabled={pending}
                  data-new-board-cloud
                  onClick={() => {
                    closePicker();
                    void createCloudBoard(template);
                  }}
                >
                  <CloudIcon />
                  <span className="min-w-0 truncate">In the cloud</span>
                  <span className="min-w-0 truncate text-muted-foreground">
                    Works when your computer is off
                  </span>
                </Button>
              </li>
            ) : null}
          </ul>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}

/** What a new board starts with: blank, the first and focused choice, or a template. */
function NewBoardTemplatePicker() {
  const startNewBoard = useStartNewBoard();
  const createCloudBoard = useCreateCloudBoard();
  const operable = useOperableEnvironments();
  // With no machine to make it on, New board makes it in the cloud anyway.
  const cloudOnly = hasCloudBoards() && operable.size === 0;
  const [inCloud, setInCloud] = useState(false);
  const cloud = cloudOnly || inCloud;
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) closeTemplates();
      }}
    >
      <DialogPopup className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>New board</DialogTitle>
          <DialogDescription>Start blank, or from a layout to fill in.</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-new-board-templates>
            {BOARD_TEMPLATES.map((template, index) => (
              <li key={template.id}>
                <button
                  type="button"
                  // Blank is the default, so Enter makes the board New board always made.
                  autoFocus={index === 0}
                  disabled={cloud && !fitsCloud(template)}
                  className="flex h-full w-full flex-col overflow-hidden rounded-board border border-board-hairline bg-card text-start shadow-paint outline-none transition-shadow hover:shadow-board focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:pointer-events-none disabled:opacity-50"
                  data-board-template={template.id}
                  onClick={() => {
                    closeTemplates();
                    void (inCloud ? createCloudBoard(template) : startNewBoard(template));
                  }}
                >
                  <span className="border-b border-board-hairline">
                    <BoardThumbnail shapes={boardTemplateShapes(template)} />
                  </span>
                  <span className="flex flex-col gap-0.5 p-2.5">
                    <span className="text-sm font-semibold">{template.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {cloud && !fitsCloud(template)
                        ? "Needs an agent, which a cloud board does not have yet."
                        : cloud
                          ? (template.cloudDescription ?? template.description)
                          : template.description}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </DialogPanel>
        {hasCloudBoards() && !cloudOnly ? (
          <DialogFooter>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Switch
                checked={inCloud}
                aria-label="Make it in the cloud"
                onCheckedChange={(checked) => setInCloud(Boolean(checked))}
                data-new-board-in-cloud
              />
              <span className="font-medium">In the cloud</span>
              <span className="text-muted-foreground">Works when your computer is off</span>
            </label>
          </DialogFooter>
        ) : null}
      </DialogPopup>
    </Dialog>
  );
}

/** Asks the name a new cloud board's maker joins it under, once per browser. */
function CloudBoardNameDialog({ template }: { readonly template: BoardTemplate }) {
  const createCloudBoard = useCreateCloudBoard();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === "" || pending) return;
    rememberBoardName(trimmed);
    setPending(true);
    const made = await createCloudBoard(template, trimmed);
    setPending(false);
    if (made) closeCloudName();
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) closeCloudName();
      }}
    >
      <DialogPopup className="sm:max-w-sm" bottomStickOnMobile={false}>
        <form className="flex min-h-0 flex-col" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>New board</DialogTitle>
            <DialogDescription>
              This board lives in the cloud, so it works when your computer is off. Everyone on it
              sees your name.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Your name
              <Input
                autoFocus
                autoComplete="name"
                maxLength={GUEST_NAME_MAX_LENGTH}
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
                data-cloud-board-name
              />
            </label>
          </DialogPanel>
          <DialogFooter variant="bare">
            <Button type="submit" disabled={pending || name.trim() === ""}>
              Start board
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
