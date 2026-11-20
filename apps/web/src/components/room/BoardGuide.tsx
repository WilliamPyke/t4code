import type { RoomBoardNoteColor } from "@t3tools/contracts";
import {
  BotIcon,
  ChevronDownIcon,
  CircleCheckIcon,
  CircleIcon,
  LinkIcon,
  ListChecksIcon,
  SplineIcon,
  XIcon,
} from "lucide-react";
import { type MouseEvent, type ReactNode, useState } from "react";

import { useBoardAccount } from "~/guest/boardAccount";
import { cn } from "~/lib/utils";

import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { BoardFloat } from "./BoardChrome";
import { paintSwatchClassName } from "./RoomNoteColor";
import {
  boardGuideFoldsAfterStep,
  collapseBoardGuide,
  hideBoardGuide,
  initialBoardGuideState,
  useBoardGuideState,
} from "./boardGuideState";
import { type BoardGuideInput, type BoardGuideStepId, boardGuideSteps } from "./boardGuide.logic";

const STEP_TEXT: Readonly<
  Record<BoardGuideStepId, { readonly label: string; readonly hint: string }>
> = {
  note: {
    label: "Add a note",
    hint: "Picks the note tool in the toolbar. Then click anywhere on the board.",
  },
  line: {
    label: "Connect two cards",
    hint: "Picks the line tool in the toolbar. Click one card, then another. An agent reads the cards its lines join.",
  },
  invite: {
    label: "Invite a teammate",
    hint: "Gets this board's invite link, to send to a teammate.",
  },
  agent: {
    label: "Bring your agent",
    hint: "Shows how to connect your computer. Agents run on each person's own computer, so nobody else can start yours.",
  },
};

/**
 * The board's first-run guide: a few steps that tick themselves as the person does them, docked
 * in the bottom right corner over the canvas. It folds to a pill and hides for good; the board
 * menu brings it back. Its progress is the signed-in person's, not the browser's. Nothing here
 * changes the board or reaches an agent.
 */
export function BoardGuide({
  hidden,
  noteColor,
  onNote,
  onLine,
  onInvite,
  onAgent,
  ...input
}: Omit<BoardGuideInput, "done"> & {
  /** Out of the way for now, as in the Plan, and still to show when the board comes back. */
  readonly hidden: boolean;
  /** The colour of the Note tool's mark, so the step shows what to look for in the toolbar. */
  readonly noteColor: RoomBoardNoteColor | undefined;
  /** Each does its step, or shows where it is done; absent where the viewer cannot right now. */
  readonly onNote: ((event: MouseEvent<HTMLElement>) => void) | undefined;
  readonly onLine: (() => void) | undefined;
  readonly onInvite: (() => void) | undefined;
  readonly onAgent: (() => void) | undefined;
}) {
  const [initial] = useState(initialBoardGuideState);
  const state = useBoardGuideState(initial);
  // Until sign-in says who this is, what this browser keeps may be the last person's.
  const whoKnown = useBoardAccount().status !== "loading";
  const steps = boardGuideSteps({ ...input, done: state.done });
  if (!whoKnown || hidden || state.hidden || steps.length === 0) return null;
  const done = steps.filter((step) => step.done).length;
  const complete = done === steps.length;
  const how: Readonly<
    Record<
      BoardGuideStepId,
      {
        readonly icon: ReactNode;
        readonly run: ((event: MouseEvent<HTMLElement>) => void) | undefined;
      }
    >
  > = {
    note: {
      icon: (
        <span
          className={cn(
            "size-3.5 rounded-sm ring-1 ring-foreground/15",
            paintSwatchClassName(noteColor),
          )}
        />
      ),
      run: onNote,
    },
    line: { icon: <SplineIcon />, run: onLine },
    invite: { icon: <LinkIcon />, run: onInvite },
    agent: { icon: <BotIcon />, run: onAgent },
  };
  // On a phone the open guide covers the board its step needs next, so it folds to its pill.
  const start =
    (run: (event: MouseEvent<HTMLElement>) => void) => (event: MouseEvent<HTMLElement>) => {
      if (boardGuideFoldsAfterStep()) collapseBoardGuide(true);
      run(event);
    };
  const hide = () => {
    hideBoardGuide();
    if (complete) return;
    toastManager.add({
      type: "info",
      title: "Getting started is hidden",
      description: "Bring it back any time from the board menu, beside the board's name.",
    });
  };
  const open = !state.collapsed;
  // Clear of the toolbar until the board is wide enough for both on one row.
  const corner = "absolute right-3 bottom-16 z-30 @5xl/board:bottom-3";
  return (
    <>
      {/* Always there while the guide is not hidden: a selection docked over the open guide's
          place, as on a phone, leaves the pill, never nothing. */}
      <div
        data-board-guide="collapsed"
        className={cn(corner, open && "hidden group-has-[[data-selection-docked]]/room:block")}
      >
        <BoardFloat className="p-1">
          <Button
            size="xs"
            variant="ghost"
            aria-expanded={false}
            onClick={() => collapseBoardGuide(false)}
          >
            <ListChecksIcon />
            <span className="@max-md/board:sr-only">Getting started</span>
            <span className="text-muted-foreground tabular-nums">
              {done}/{steps.length}
            </span>
          </Button>
        </BoardFloat>
      </div>
      {open ? (
        <div
          data-board-guide="open"
          className={cn(
            corner,
            // On a phone the open card sits above the zoom controls, which share its row.
            "group-has-[[data-selection-docked]]/room:hidden @max-md/board:bottom-28",
          )}
        >
          <BoardFloat
            role="region"
            aria-label="Getting started"
            className="w-64 flex-col items-stretch gap-2 p-3"
          >
            <div className="flex items-center gap-1">
              <p className="min-w-0 flex-1 truncate text-sm font-semibold">
                {complete ? "You're all set" : "Getting started"}
              </p>
              <span className="pe-1 text-xs text-muted-foreground tabular-nums">
                {done} of {steps.length}
              </span>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      size="icon-xs"
                      variant="ghost-muted"
                      aria-label="Minimize getting started"
                      aria-expanded
                      onClick={() => collapseBoardGuide(true)}
                    />
                  }
                >
                  <ChevronDownIcon />
                </TooltipTrigger>
                <TooltipPopup side="top">Minimize</TooltipPopup>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      size="icon-xs"
                      variant="ghost-muted"
                      aria-label="Hide getting started"
                      onClick={hide}
                    />
                  }
                >
                  <XIcon />
                </TooltipTrigger>
                <TooltipPopup side="top">Hide. The board menu brings it back.</TooltipPopup>
              </Tooltip>
            </div>
            <div
              role="progressbar"
              aria-label="Steps done"
              aria-valuemin={0}
              aria-valuemax={steps.length}
              aria-valuenow={done}
              className="h-1 overflow-hidden rounded-full bg-foreground/8"
            >
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-300 motion-reduce:transition-none"
                style={{ width: `${(done / steps.length) * 100}%` }}
              />
            </div>
            <ul className="-mx-1.5 flex flex-col">
              {steps.map((step) => {
                const { label, hint } = STEP_TEXT[step.id];
                const { icon, run } = how[step.id];
                return (
                  <li
                    key={step.id}
                    data-board-guide-step={step.id}
                    data-done={step.done || undefined}
                  >
                    {step.done ? (
                      <span className="flex items-center gap-2 px-1.5 py-1 text-sm text-muted-foreground pointer-coarse:min-h-9">
                        <CircleCheckIcon aria-hidden className="size-4 shrink-0 text-success" />
                        {label}
                        <span className="sr-only">(done)</span>
                      </span>
                    ) : (
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <button
                              type="button"
                              disabled={run === undefined}
                              className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:pointer-events-none disabled:opacity-64 pointer-coarse:min-h-9"
                              onClick={run === undefined ? undefined : start(run)}
                            />
                          }
                        >
                          <CircleIcon
                            aria-hidden
                            className="size-4 shrink-0 text-muted-foreground/60"
                          />
                          <span className="min-w-0 flex-1">{label}</span>
                          <span
                            aria-hidden
                            className="flex shrink-0 text-muted-foreground [&_svg]:size-3.5"
                          >
                            {icon}
                          </span>
                        </TooltipTrigger>
                        <TooltipPopup side="left">{hint}</TooltipPopup>
                      </Tooltip>
                    )}
                  </li>
                );
              })}
            </ul>
          </BoardFloat>
        </div>
      ) : null}
    </>
  );
}
