import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import {
  DEFAULT_PROVIDER_INTERACTION_MODE,
  ROOM_BOARD_THREAD_CARD,
  type ScopedThreadRef,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { Atom } from "effect/reactivity";
import { useEffect, useEffectEvent, useState } from "react";

import { isCommandPaletteOpen, openCommandPalette } from "~/commandPaletteBus";
import { getLocalStorageItem, setLocalStorageItem } from "~/hooks/useLocalStorage";
import { useScratchProject } from "~/hooks/useScratchProject";
import { registerCommands } from "~/shortcuts/dispatcher";
import { newThreadId } from "~/lib/utils";
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
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";

import { sortScopedProjectsForSidebar } from "../Sidebar.logic";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { toastManager } from "../ui/toast";
import { nameBoardOnOpen } from "./BoardTitle";
import {
  UNTITLED_BOARD,
  listHomeBoards,
  newBoardProject,
  newBoardProjectKey,
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

const pickerOpenAtom = Atom.make(false).pipe(
  Atom.keepAlive,
  Atom.withLabel("boards:new-board-picker"),
);
const closePicker = () => appAtomRegistry.set(pickerOpenAtom, false);

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
  return async (project: EnvironmentProject): Promise<boolean> => {
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
    // An unshared board with nothing on it is not kept; placing the thread's own card keeps it.
    await changeBoard({
      environmentId: project.environmentId,
      input: {
        threadId,
        change: { type: "card.move", cardId: ROOM_BOARD_THREAD_CARD, x: 80, y: 72 },
      },
    });
    rememberLastProject(project);
    const ref = scopeThreadRef(project.environmentId, threadId);
    // Typing on a new board names it; it never reaches a prompt the user has not clicked into.
    nameBoardOnOpen(ref);
    void navigate(newBoardLocation(ref));
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
  return async () => {
    const decision = newBoardProject({
      projects,
      boards: listHomeBoards({ threads, joined: [], teams: [], isOwnEnvironment: () => true }),
      lastUsed: readLastProject(),
    });
    if (decision.kind === "use") {
      await createBoard(decision.project);
      return;
    }
    if (decision.kind === "ask") {
      appAtomRegistry.set(pickerOpenAtom, true);
      return;
    }
    const environmentId = scratchEnvironmentId(primaryEnvironmentId);
    const scratch =
      environmentId === null
        ? null
        : await openScratchProject(environmentId, "Could not start a board");
    if (scratch !== null) {
      await createBoard(scratch);
      return;
    }
    openCommandPalette({ open: "add-project" });
  };
}

/** Hosted once at the root, so every New board can ask which project when it has to. */
export function NewBoardDialogHost() {
  const pickerOpen = useAtomValue(pickerOpenAtom);
  return (
    <>
      <BoardShortcuts />
      {pickerOpen ? <NewBoardProjectPicker /> : null}
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
            // A browser that only joined guest links has nowhere to make a board.
            if (readGuestOnly()) return false;
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

function NewBoardProjectPicker() {
  const projects = useProjects();
  const threads = useThreadShells();
  const createBoard = useCreateBoard();
  const [pending, setPending] = useState(false);
  // Most recently used first.
  const choices = sortScopedProjectsForSidebar(
    projects.filter((project) => project.archivedAt == null),
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
                    const made = await createBoard(project);
                    setPending(false);
                    if (made) closePicker();
                  }}
                >
                  <span className="min-w-0 truncate">{project.title}</span>
                </Button>
              </li>
            ))}
          </ul>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
