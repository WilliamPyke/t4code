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
  CommandId,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  type EnvironmentId,
  CLOUD_BOARD_TITLE_MAX_LENGTH,
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
  cloudBoardHandoff,
  createCloudBoard,
  knownBoardName,
  putOnCloudBoard,
  rememberBoardName,
  suggestedBoardName,
} from "~/guest/cloudBoards";
import { cloudBoardsOrigin } from "~/guest/cloudBoardsHost";
import { type JoinedGuestShare, guestShareLocation, rememberGuestShare } from "~/guest/guestShares";
import { getLocalStorageItem, setLocalStorageItem } from "~/hooks/useLocalStorage";
import { useScratchProject } from "~/hooks/useScratchProject";
import { registerCommands } from "~/shortcuts/dispatcher";
import { newThreadId, randomUUID } from "~/lib/utils";
import { resolveProjectDefaultProviderModelSelection } from "~/providerInstances";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { projectEnvironment } from "~/state/projects";
import { readProjects, useProjects, useThreadShells } from "~/state/entities";
import {
  readGuestOnly,
  useEnvironmentProviders,
  useEnvironments,
  usePrimaryEnvironmentId,
} from "~/state/environments";
import { environmentPresentations } from "~/state/presentation";
import { serverEnvironment } from "~/state/server";
import { environmentSession, sessionHasScope } from "~/state/session";
import { environmentShell } from "~/state/shell";
import { threadEnvironment } from "~/state/threads";
import { waitForAtomValue } from "~/state/waitForAtomValue";
import { useAtomCommand } from "~/state/use-atom-command";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";

import { announceRoomMachineJoined } from "../guest/ownRoomMachine";
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
  type NewBoardPlace,
  UNTITLED_BOARD,
  listHomeBoards,
  newBoardProjectKey,
  newBoardStart,
  newCloudBoardAgent,
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

// Per browser: where the person last chose to make a board. The cloud until they pick otherwise.
const PLACE_KEY = "t3code:new-board-place:v1";
const Place = Schema.Literals(["cloud", "machine"]);

const readPlace = (): NewBoardPlace => {
  try {
    return getLocalStorageItem(PLACE_KEY, Place) ?? "cloud";
  } catch {
    return "cloud";
  }
};

const rememberPlace = (place: NewBoardPlace) => {
  try {
    setLocalStorageItem(PLACE_KEY, place, Place);
  } catch {
    // Storage that is full or blocked only loses the choice.
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

// A machine in any other phase is unreachable for now, so New board does not wait for it.
const STILL_CONNECTING = new Set(["available", "connecting", "connected"]);

/**
 * The machines this browser keeps: those it may make a board on now (allowed to, projects
 * loaded), and those that may yet, whose session is still loading.
 */
const newBoardMachinesAtom = Atom.make((get) => {
  const operable = new Set<string>();
  const connecting = new Set<string>();
  for (const [environmentId, presentation] of get(environmentPresentations.presentationsAtom)) {
    if (isGuestEnvironment(environmentId)) continue;
    const session = get(environmentSession.sessionStateAtom(environmentId));
    const granted = sessionHasScope(session, AuthOrchestrationOperateScope);
    if (granted && get(environmentShell.hasSnapshotAtom(environmentId))) {
      operable.add(environmentId);
    } else if (
      (granted || session._tag === "Initial") &&
      STILL_CONNECTING.has(presentation.connection.phase)
    ) {
      connecting.add(environmentId);
    }
  }
  return { operable, connecting };
}).pipe(Atom.withLabel("boards:new-board-machines"));

const useOperableEnvironments = () => useAtomValue(newBoardMachinesAtom).operable;

// Long enough for a saved machine's session to load after the page does.
const MACHINE_WAIT_MS = 6_000;

const newBoardWaitingAtom = Atom.make(false).pipe(
  Atom.keepAlive,
  Atom.withLabel("boards:new-board-waiting"),
);
/** Whether New board is waiting for a machine still connecting before choosing where to go. */
export const useNewBoardWaiting = () => useAtomValue(newBoardWaitingAtom);

/** Waits until a machine can take a board or none is still connecting; never past the limit. */
const waitForMachines = () =>
  waitForAtomValue({
    registry: appAtomRegistry,
    atom: newBoardMachinesAtom,
    predicate: (machines) => machines.operable.size > 0 || machines.connecting.size === 0,
    timeoutMs: MACHINE_WAIT_MS,
  });

/** Where a board opens right after it is made: full size, no conversation beside it. */
const newBoardLocation = (ref: ScopedThreadRef) => ({
  to: "/board/$roomEnvironmentId/$roomThreadId" as const,
  params: { roomEnvironmentId: ref.environmentId, roomThreadId: ref.threadId },
  search: {},
});

/** The user's own defaults for a new thread in a project, or null with no provider set up. */
function useNewThreadDefaults() {
  const { environments } = useEnvironments();
  const providersByEnvironment = useEnvironmentProviders();
  return (project: EnvironmentProject) => {
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
    return projectSettings === null || modelSelection === null
      ? null
      : { modelSelection, runtimeMode: projectSettings.settings.defaultRuntimeMode };
  };
}

/**
 * Makes a board in a project: a thread underneath, with the user's own defaults, whose board is
 * kept from the start so it is listed even before anything is on it. Opens it once made.
 */
function useCreateBoard() {
  const navigate = useNavigate();
  const threadDefaults = useNewThreadDefaults();
  const createThread = useOrchestrationCommand(threadEnvironment.create, {
    reportFailure: false,
  });
  const changeBoard = useAtomCommand(serverEnvironment.changeGuestBoard, {
    reportFailure: false,
  });
  return async (
    project: EnvironmentProject,
    template: BoardTemplate = BLANK_BOARD_TEMPLATE,
    title: string | null = null,
  ): Promise<boolean> => {
    const defaults = threadDefaults(project);
    if (defaults === null) {
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
        title: title ?? UNTITLED_BOARD,
        ...defaults,
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
    const changes = boardTemplateChanges(template, randomUUID);
    const put = async (change: (typeof changes)[number]) =>
      (
        await changeBoard({
          environmentId: project.environmentId,
          input: { threadId, change },
        })
      )._tag === "Success";
    const [first, ...rest] = changes;
    const kept = first === undefined || (await put(first));
    rememberLastProject(project);
    const ref = scopeThreadRef(project.environmentId, threadId);
    // A template's board opens showing all of it, once its cards reach this page.
    const notes = changes.filter((change) => change.type === "note.put").length;
    if (notes > 0) fitRoomBoardOnOpen(roomBoardViewKey(ref), notes);
    // Typing on a new board names it; it never reaches a prompt the user has not clicked into.
    if (title === null) nameBoardOnOpen(ref);
    // Open it now; the rest of the template lands on the open board.
    void navigate(newBoardLocation(ref));
    void (async () => {
      let complete = kept;
      for (const change of rest) {
        if (!complete) break;
        complete = await put(change);
      }
      if (!complete) toastTemplateMissing();
    })();
    return true;
  };
}

const toastTemplateMissing = () =>
  toastManager.add({
    type: "error",
    title: "Some of the template is missing",
    description: "The board was made, but not all of its cards could be added.",
  });

/**
 * Brings this person's agent to a cloud board they just made, in the background, as the join
 * page would: their only machine that may, in the project a machine board would have gone in, or
 * none. When it cannot, the board's Bring your agent asks them as before.
 */
function useBringAgentToNewBoard() {
  const projects = useProjects();
  const threads = useThreadShells();
  const threadDefaults = useNewThreadDefaults();
  const openScratch = useAtomCommand(projectEnvironment.openScratch, { reportFailure: false });
  const joinSharedThread = useAtomCommand(serverEnvironment.joinSharedThread, {
    reportFailure: false,
  });
  return async (share: JoinedGuestShare) => {
    const agent = newCloudBoardAgent({
      projects: projects.filter((project) => project.archivedAt == null),
      boards: listHomeBoards({ threads, joined: [], teams: [], isOwnEnvironment: () => true }),
      lastUsed: readLastProject(),
      operable: appAtomRegistry.get(newBoardMachinesAtom).operable,
    });
    if (agent === null) return;
    const environmentId = agent.environmentId as EnvironmentId;
    let project = agent.project;
    if (project === null) {
      const scratch = await openScratch({ environmentId, input: {} });
      if (scratch._tag === "Failure") return;
      project = scratch.value;
    }
    const defaults = threadDefaults(project);
    const token = defaults === null ? null : await cloudBoardHandoff(share);
    if (defaults === null || token === null) return;
    const joined = await joinSharedThread({
      environmentId,
      input: {
        commandId: CommandId.make(randomUUID()),
        source: { host: share.host, token },
        projectId: project.id,
        ...defaults,
        interactionMode: DEFAULT_PROVIDER_INTERACTION_MODE,
        checkout: false,
      },
    });
    if (joined._tag === "Success") announceRoomMachineJoined(share.shareId);
  };
}

/**
 * Makes a board on the cloud host, on nobody's machine, as the name this browser joins boards
 * under, asking for it first when there is none. Opens it once made, while its maker's agent
 * comes along.
 */
function useCreateCloudBoard() {
  const navigate = useNavigate();
  const bringAgent = useBringAgentToNewBoard();
  return async (
    template: BoardTemplate = BLANK_BOARD_TEMPLATE,
    name: string | null = knownBoardName(),
    title: string | null = null,
  ): Promise<boolean> => {
    const changes = cloudBoardTemplateChanges(template, randomUUID);
    if (changes === null) {
      toastManager.add({
        type: "error",
        title: "Could not start a board",
        description: "This template needs a board on your computer.",
      });
      return false;
    }
    if (name === null) {
      appAtomRegistry.set(cloudNameAtom, template);
      return false;
    }
    const created = await createCloudBoard({ name, title: title ?? UNTITLED_BOARD });
    if (typeof created === "string") {
      toastManager.add({ type: "error", title: "Could not start a board", description: created });
      return false;
    }
    rememberGuestShare(created);
    const ref = scopeThreadRef(guestEnvironmentId(created.shareId), created.threadId);
    const notes = changes.filter((change) => change.type === "note.put").length;
    if (notes > 0) fitRoomBoardOnOpen(`guest:${created.shareId}`, notes);
    if (title === null) nameBoardOnOpen(ref);
    // Straight onto the new board, wherever it was started from; its template lands there live.
    void navigate(guestShareLocation(created));
    void putOnCloudBoard(created, changes).then((complete) => {
      if (!complete) toastTemplateMissing();
    });
    void bringAgent(created);
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
  const createCloudBoard = useCreateCloudBoard();
  const machines = useAtomValue(newBoardMachinesAtom);
  return async (
    template: BoardTemplate = BLANK_BOARD_TEMPLATE,
    place: NewBoardPlace = readPlace(),
    /** What it is called from the start; without, the board opens with its name to type. */
    title: string | null = null,
  ) => {
    if (appAtomRegistry.get(newBoardWaitingAtom)) return;
    const decide = (now: typeof machines, waited: boolean) =>
      newBoardStart({
        // After the wait, read again: the machine that finished connecting brought its projects.
        projects: waited ? readProjects() : projects,
        boards: listHomeBoards({ threads, joined: [], teams: [], isOwnEnvironment: () => true }),
        lastUsed: readLastProject(),
        ...now,
        waited,
        cloud: hasCloudBoards() && fitsCloud(template),
        place,
      });
    let decision = decide(machines, false);
    if (decision.kind === "wait") {
      appAtomRegistry.set(newBoardWaitingAtom, true);
      const failed = await waitForMachines().then(
        () => null,
        (error: unknown) => ({ error }),
      );
      appAtomRegistry.set(newBoardWaitingAtom, false);
      if (failed !== null) throw failed.error;
      decision = decide(appAtomRegistry.get(newBoardMachinesAtom), true);
    }
    if (decision.kind === "cloud") {
      await createCloudBoard(template, knownBoardName(), title);
      return;
    }
    if (decision.kind === "use") {
      await createBoard(decision.project, template, title);
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
      await createBoard(scratch, template, title);
      return;
    }
    openCommandPalette({ open: "add-project" });
  };
}

/**
 * The templates New board would offer now, and where it would make them: the boards home's
 * template row offers the same ones the template picker does.
 */
export function useOfferedTemplates(): {
  readonly templates: ReadonlyArray<BoardTemplate>;
  readonly place: NewBoardPlace;
} {
  const machines = useAtomValue(newBoardMachinesAtom);
  const cloudOnly =
    hasCloudBoards() && machines.operable.size === 0 && machines.connecting.size === 0;
  const cloud = hasCloudBoards() && (cloudOnly || readPlace() !== "machine");
  return {
    templates: cloud ? BOARD_TEMPLATES.filter(fitsCloud) : BOARD_TEMPLATES,
    place: cloud ? "cloud" : "machine",
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
                    rememberPlace("cloud");
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
  const machines = useAtomValue(newBoardMachinesAtom);
  // With no machine to make it on, New board makes it in the cloud anyway.
  const cloudOnly =
    hasCloudBoards() && machines.operable.size === 0 && machines.connecting.size === 0;
  const [onComputer, setOnComputer] = useState(() => readPlace() === "machine");
  const cloud = hasCloudBoards() && (cloudOnly || !onComputer);
  // Only what can be made here: a template that needs a computer is not offered in the cloud.
  const templates = cloud ? BOARD_TEMPLATES.filter(fitsCloud) : BOARD_TEMPLATES;
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
            {templates.map((template, index) => (
              <li key={template.id}>
                <button
                  type="button"
                  // Blank is the default, so Enter makes the board New board always made.
                  autoFocus={index === 0}
                  className="flex h-full w-full flex-col overflow-hidden rounded-board border border-board-hairline bg-card text-start shadow-paint outline-none transition-shadow hover:shadow-board focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  data-board-template={template.id}
                  onClick={() => {
                    closeTemplates();
                    const place = cloud ? "cloud" : "machine";
                    if (hasCloudBoards() && !cloudOnly) rememberPlace(place);
                    void startNewBoard(template, place);
                  }}
                >
                  <span className="border-b border-board-hairline">
                    <BoardThumbnail shapes={boardTemplateShapes(template, cloud)} />
                  </span>
                  <span className="flex flex-col gap-0.5 p-2.5">
                    <span className="text-sm font-semibold">{template.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {cloud
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
                checked={onComputer}
                aria-label="Make it on this computer"
                onCheckedChange={(checked) => setOnComputer(Boolean(checked))}
                data-new-board-on-computer
              />
              <span className="font-medium">On this computer</span>
              <span className="text-muted-foreground">
                It must be on for others to open the board
              </span>
            </label>
          </DialogFooter>
        ) : null}
      </DialogPopup>
    </Dialog>
  );
}

/** Asks the name a new cloud board's maker joins it under, once per browser, and the board's. */
function CloudBoardNameDialog({ template }: { readonly template: BoardTemplate }) {
  const createCloudBoard = useCreateCloudBoard();
  const [name, setName] = useState(suggestedBoardName);
  const [title, setTitle] = useState("");
  const [pending, setPending] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === "" || pending) return;
    rememberBoardName(trimmed);
    setPending(true);
    const made = await createCloudBoard(template, trimmed, title.trim() || null);
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
            <DialogTitle>Start a board</DialogTitle>
            <DialogDescription>
              Everyone you invite sees your name. You only pick it once.
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
                onFocus={(event) => event.currentTarget.select()}
                onChange={(event) => setName(event.currentTarget.value)}
                data-cloud-board-name
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Board name
              <Input
                maxLength={CLOUD_BOARD_TITLE_MAX_LENGTH}
                placeholder={UNTITLED_BOARD}
                value={title}
                onChange={(event) => setTitle(event.currentTarget.value)}
                data-cloud-board-title
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
