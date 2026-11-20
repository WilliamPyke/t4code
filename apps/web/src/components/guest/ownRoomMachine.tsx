import { isGuestEnvironment, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  type EnvironmentId,
  GuestShareId,
  type ModelSelection,
  type RoomBoxModel,
  type ThreadId,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { Atom } from "effect/reactivity";
import { MonitorIcon } from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";

import { getLocalStorageItem, setLocalStorageItem } from "~/hooks/useLocalStorage";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useProjects, useThreadShell } from "~/state/entities";
import { useEnvironments } from "~/state/environments";
import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";

import { BoardModelPicker, ThreadBoardModelPicker } from "../room/BoardModelPicker";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { boxComputer } from "./bringAgent.logic";

/** The guest's own machine that joined a room: its thread from the room, and its boxes' threads. */
export interface OwnRoomMachine {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly boxes: Readonly<Record<string, ThreadId>>;
}

// Bumped when one of this person's machines joins a room from this page, so the room asks again.
const roomMachineJoinsAtom = Atom.family((_shareId: string) =>
  Atom.make(0).pipe(Atom.keepAlive, Atom.withLabel("guest:room-machine-joins")),
);

/** Tells an open room that one of this person's machines just joined it. */
export const announceRoomMachineJoined = (shareId: string) =>
  appAtomRegistry.update(roomMachineJoinsAtom(shareId), (count) => count + 1);

/** One of the person's own computers, as a box's computer picker lists it. */
export interface OwnComputer {
  readonly environmentId: EnvironmentId;
  readonly name: string;
  readonly connected: boolean;
  /** Its agent is on this board. */
  readonly here: boolean;
}

/** Where one of the person's boxes runs, among their own computers. */
export interface OwnBoxComputer {
  /** The computer a prompt to the box runs on now, or null when none can run it. */
  readonly machine: OwnRoomMachine | null;
  /** The box's chat is on a computer, so it runs there and nowhere else. */
  readonly fixed: boolean;
  /** The name of the computer its chat is on, while that one is not connected. */
  readonly stranded: string | null;
}

// Per browser and board: the computer last chosen there, and the one each box's chat is on.
const BOARD_COMPUTERS_KEY = "t3code:board-computers:v1";
const BoardComputers = Schema.Record(
  Schema.String,
  Schema.Struct({
    picked: Schema.NullOr(Schema.String),
    boxes: Schema.Record(Schema.String, Schema.String),
  }),
);
type BoardComputerMemory = (typeof BoardComputers.Type)[string];
const NO_MEMORY: BoardComputerMemory = { picked: null, boxes: {} };

const readBoardComputers = (): typeof BoardComputers.Type => {
  try {
    return getLocalStorageItem(BOARD_COMPUTERS_KEY, BoardComputers) ?? {};
  } catch {
    return {};
  }
};

function writeBoardComputers(shareId: string, memory: BoardComputerMemory) {
  try {
    setLocalStorageItem(
      BOARD_COMPUTERS_KEY,
      { ...readBoardComputers(), [shareId]: memory },
      BoardComputers,
    );
  } catch {
    // Blocked storage only means the choice lasts until this page is reloaded.
  }
}

/**
 * Which of the guest's own machines joined this room. `machine` is the one a new box runs on:
 * `undefined` while they are asked, `null` when none joined or none that did is connected now,
 * so a box's prompt goes to the owner. A box with a chat runs where `boxOn` says.
 */
export function useOwnRoomMachine(share: { readonly host: string; readonly shareId: string }): {
  readonly machine: OwnRoomMachine | null | undefined;
  /** Every machine of theirs that joined and is connected now. */
  readonly machines: ReadonlyArray<OwnRoomMachine>;
  /** The person's computers this browser knows, on this board or not. */
  readonly computers: ReadonlyArray<OwnComputer>;
  readonly boxOn: (boxId: string) => OwnBoxComputer;
  /** Makes one of their computers the one new boxes run on, here and after a reload. */
  readonly choose: (environmentId: EnvironmentId) => void;
  /** Lets a box whose computer is not connected start a new chat on one that is. */
  readonly startOver: (boxId: string) => void;
  /** One joined while this page was open, and none is connected now. */
  readonly away: boolean;
  /** That machine left the room: it runs nothing here until it joins again. */
  readonly forget: (environmentId: EnvironmentId) => void;
  /** Records the thread a box's prompt just ran in. */
  readonly setBoxThread: (environmentId: EnvironmentId, boxId: string, threadId: ThreadId) => void;
} {
  const own = useEnvironments().environments.filter(
    (environment) => !isGuestEnvironment(environment.environmentId),
  );
  const withProjects = new Set(useProjects().map((project) => project.environmentId));
  // The guest's own machines: the ones with projects, which a shared thread's page has none of.
  // Only connected ones can answer, and one that connects later is asked then.
  const environmentIds = own
    .filter(
      (environment) =>
        environment.connection.phase === "connected" && withProjects.has(environment.environmentId),
    )
    .map((environment) => environment.environmentId)
    .toSorted();
  const environmentKey = environmentIds.join("\n");
  const findSharedRoom = useAtomCommand(serverEnvironment.findSharedRoom, { reportFailure: false });
  const [found, setFound] = useState<ReadonlyArray<OwnRoomMachine> | undefined>(undefined);
  const [wasHere, setWasHere] = useState(false);
  const [memory, setMemory] = useState(() => readBoardComputers()[share.shareId] ?? NO_MEMORY);
  const remember = (change: (known: BoardComputerMemory) => BoardComputerMemory) =>
    setMemory((known) => {
      const next = change(known);
      writeBoardComputers(share.shareId, next);
      return next;
    });
  const rememberJoined = useEffectEvent((joined: ReadonlyArray<OwnRoomMachine>) => {
    if (joined.length === 0) return;
    setWasHere(true);
    const boxes = Object.fromEntries(
      joined.flatMap((machine) =>
        Object.keys(machine.boxes).map((boxId) => [boxId, machine.environmentId]),
      ),
    );
    // A box two computers have a chat for stays on the one it was last seen on.
    remember((known) => ({ ...known, boxes: { ...boxes, ...known.boxes } }));
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- asks the guest's own servers which of them joined this room
  useEffect(() => {
    let current = true;
    let any = false;
    const ask = async () => {
      const asked = environmentKey === "" ? [] : (environmentKey.split("\n") as EnvironmentId[]);
      const answers = await Promise.all(
        asked.map(async (environmentId) => {
          const result = await findSharedRoom({
            environmentId,
            input: { host: share.host, shareId: GuestShareId.make(share.shareId) },
          });
          return result._tag === "Success" && result.value.threadId !== null
            ? [{ environmentId, threadId: result.value.threadId, boxes: result.value.boxes }]
            : [];
        }),
      );
      if (!current) return;
      const joined = answers.flat();
      any = joined.length > 0;
      rememberJoined(joined);
      setFound(joined);
    };
    void ask();
    // Until one is found: the guest may join this room on their machine in another tab.
    const again = () => {
      if (!any && document.visibilityState === "visible") void ask();
    };
    document.addEventListener("visibilitychange", again);
    // Or right away, when one of their machines joined it from this page: a second one may.
    const stopListening = appAtomRegistry.subscribe(
      roomMachineJoinsAtom(share.shareId),
      () => void ask(),
    );
    return () => {
      current = false;
      document.removeEventListener("visibilitychange", again);
      stopListening();
    };
  }, [environmentKey, findSharedRoom, share.host, share.shareId]);
  const here = found?.filter((machine) => environmentIds.includes(machine.environmentId));
  const unreachable = new Set<string>(
    own
      .map((environment) => environment.environmentId)
      .filter((environmentId) => !environmentIds.includes(environmentId)),
  );
  const boxOn = (boxId: string): OwnBoxComputer => {
    const on = boxComputer({
      here: here ?? [],
      boxId,
      picked: memory.picked,
      remembered: memory.boxes[boxId] ?? null,
      disconnected: unreachable,
    });
    return {
      ...on,
      stranded:
        on.stranded === null
          ? null
          : (own.find((environment) => environment.environmentId === on.stranded)?.label ??
            "another computer"),
    };
  };
  return {
    // No box has the empty id, so this is where a box with no chat runs.
    machine: here === undefined ? undefined : boxOn("").machine,
    machines: here ?? [],
    computers: own.map((environment) => ({
      environmentId: environment.environmentId,
      name: environment.label,
      connected: environment.connection.phase === "connected",
      here: here?.some((machine) => machine.environmentId === environment.environmentId) === true,
    })),
    boxOn,
    choose: (environmentId) => remember((known) => ({ ...known, picked: environmentId })),
    startOver: (boxId) =>
      remember((known) => ({
        ...known,
        boxes: Object.fromEntries(Object.entries(known.boxes).filter(([id]) => id !== boxId)),
      })),
    away: wasHere && here?.length === 0,
    forget: (environmentId) => {
      if (found?.every((machine) => machine.environmentId === environmentId) !== false) {
        setWasHere(false);
      }
      setFound((known) => known?.filter((machine) => machine.environmentId !== environmentId));
      // Its boxes' chats are no longer on this board, so those boxes may start over elsewhere.
      remember((known) => ({
        ...known,
        boxes: Object.fromEntries(
          Object.entries(known.boxes).filter(([, home]) => home !== environmentId),
        ),
      }));
    },
    setBoxThread: (environmentId, boxId, threadId) => {
      setFound((known = []) =>
        known.some((machine) => machine.environmentId === environmentId)
          ? known.map((machine) =>
              machine.environmentId === environmentId
                ? { ...machine, boxes: { ...machine.boxes, [boxId]: threadId } }
                : machine,
            )
          : [...known, { environmentId, threadId, boxes: { [boxId]: threadId } }],
      );
      remember((known) => ({ ...known, boxes: { ...known.boxes, [boxId]: environmentId } }));
    },
  };
}

/**
 * The model one of the guest's own boxes runs on, on their machine, and the way to change it:
 * the box thread's own once it has one, else the pick for the box, starting from the joined
 * thread's model.
 */
export function OwnBoxModelPicker({
  machine,
  boxId,
  pick,
  chosen,
  onPick,
}: {
  readonly machine: OwnRoomMachine;
  readonly boxId: string;
  /** What the box runs on while it has no thread: its pick, or the guest's for new boxes. */
  readonly pick: ModelSelection | undefined;
  /** The pick the board keeps for the box. */
  readonly chosen: RoomBoxModel | undefined;
  readonly onPick: (selection: ModelSelection, name: string) => void;
}) {
  const joined = useThreadShell(scopeThreadRef(machine.environmentId, machine.threadId));
  const projectId = joined?.projectId ?? null;
  const fallback = joined?.modelSelection ?? null;
  const boxThreadId = machine.boxes[boxId];
  if (boxThreadId !== undefined) {
    return (
      <ThreadBoardModelPicker
        threadRef={scopeThreadRef(machine.environmentId, boxThreadId)}
        projectId={projectId}
        fallback={chosen?.selection ?? fallback}
        chosen={chosen}
        onPicked={onPick}
      />
    );
  }
  const selection = pick ?? fallback;
  return selection === null ? (
    <span className="truncate text-2xs text-muted-foreground">Runs on your agent</span>
  ) : (
    <BoardModelPicker
      environmentId={machine.environmentId}
      projectId={projectId}
      selection={selection}
      onChange={onPick}
    />
  );
}

/**
 * Which of the person's own computers one of their boxes runs on, by name, for someone with
 * more than one. A box with no chat yet moves with one pick; a box with a chat says where it is.
 */
export function OwnBoxComputerPicker({
  computers,
  on,
  onChoose,
  onBring,
  onStartOver,
}: {
  readonly computers: ReadonlyArray<OwnComputer>;
  readonly on: OwnBoxComputer;
  readonly onChoose: (environmentId: EnvironmentId) => void;
  /** Opens the way to bring another computer's agent here; absent where a board has none. */
  readonly onBring: (() => void) | undefined;
  /** Lets a stranded box start a new chat on a computer that is here; absent when none is. */
  readonly onStartOver: (() => void) | undefined;
}) {
  if (computers.length < 2) return null;
  const current = computers.find(
    (computer) => computer.environmentId === on.machine?.environmentId,
  );
  const name = current?.name ?? on.stranded;
  if (name == null) return null;
  if (on.fixed) {
    return (
      <Popover>
        <PopoverTrigger
          render={<Button size="xs" variant="ghost" />}
          aria-label={`Runs on ${name}`}
          data-box-computer={on.stranded === null ? "fixed" : "stranded"}
        >
          <MonitorIcon />
          <span className="max-w-24 truncate">{name}</span>
          {on.stranded === null ? null : <span className="text-muted-foreground">offline</span>}
        </PopoverTrigger>
        <PopoverPopup side="top" align="start" width="sm">
          <div className="flex flex-col items-start gap-1.5">
            <PopoverTitle>
              {on.stranded === null ? `Runs on ${name}` : `${name} is not connected`}
            </PopoverTitle>
            <p className="text-xs text-muted-foreground">
              This agent's chat is on {name}, so it always runs there.{" "}
              {on.stranded === null
                ? "To use another computer, add a new agent and choose the computer under its prompt."
                : "Wake it, or open Tinkjam Sync on it, and this agent carries on."}
            </p>
            {on.stranded === null || onStartOver === undefined ? null : (
              <>
                <p className="text-xs text-muted-foreground">
                  Or start a new chat for it on a computer that is connected. It will not remember
                  what was said on {name}.
                </p>
                <Button size="xs" variant="outline" onClick={onStartOver}>
                  Start a new chat
                </Button>
              </>
            )}
          </div>
        </PopoverPopup>
      </Popover>
    );
  }
  return (
    <Select
      value={current?.environmentId ?? null}
      onValueChange={(next) => {
        const picked = computers.find((computer) => computer.environmentId === next);
        if (picked === undefined) return;
        if (picked.here) onChoose(picked.environmentId);
        else onBring?.();
      }}
    >
      <SelectTrigger size="xs" variant="ghost" aria-label="Computer it runs on" data-box-computer>
        <MonitorIcon />
        <SelectValue>
          <span className="block max-w-24 truncate">{name}</span>
        </SelectValue>
      </SelectTrigger>
      <SelectPopup align="start" alignItemWithTrigger={false} matchTriggerWidth={false}>
        {computers.map((computer) => (
          <SelectItem
            key={computer.environmentId}
            value={computer.environmentId}
            disabled={!computer.here && (!computer.connected || onBring === undefined)}
          >
            {computer.name}
            {computer.here ? null : (
              <span className="text-muted-foreground">
                {computer.connected
                  ? onBring === undefined
                    ? " · not on this board"
                    : " · bring its agent"
                  : " · offline"}
              </span>
            )}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}
