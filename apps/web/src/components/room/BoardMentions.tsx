import { GuestId, type RoomBoardMention } from "@t3tools/contracts";
import { roomMentionKey } from "@t3tools/shared/roomBoard";
import { createContext, type KeyboardEvent, type ReactNode, use, useState } from "react";
import { createPortal } from "react-dom";

import { useWorkspaces } from "~/guest/workspaces";
import { cn } from "~/lib/utils";

import {
  type MentionPerson,
  insertMention,
  mentionOf,
  mentionPeopleOf,
  mentionQueryAt,
  mentionSegments,
  rankMentionPeople,
} from "./boardMentions.logic";
import { boardCursorColor } from "./roomBoard.logic";

/**
 * Who a board's `@` picker offers, and who the person looking is, so a mention of them stands
 * out. A board without it (the owner's own machine) offers no picker, and shows mentions plainly.
 */
export interface BoardMentions {
  readonly people: ReadonlyArray<MentionPerson>;
  /** The mention keys that are the person looking: their seat, and their workspace membership. */
  readonly me: ReadonlyArray<string>;
  /** A person's colour on the board, by guest id. */
  readonly colorOf: (guestId: string) => string;
}

const BoardMentionsContext = createContext<BoardMentions | null>(null);

/**
 * Offers the board's people, and its workspace's members when the person looking is in that
 * workspace, to every `@` picker on the board.
 */
export function BoardMentionsProvider({
  shareId,
  guests,
  viewer,
  children,
}: {
  readonly shareId: string;
  readonly guests: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  /** Who is looking, or null for someone looking on from the view link. */
  readonly viewer: string | null;
  readonly children: ReactNode;
}) {
  const workspaces = useWorkspaces();
  const members =
    workspaces?.find((workspace) => workspace.boards.some((board) => board.shareId === shareId))
      ?.members ?? [];
  const you = members.find((member) => member.you === true);
  const value: BoardMentions = {
    people: mentionPeopleOf(guests, members, viewer),
    me: [
      ...(viewer === null ? [] : [roomMentionKey({ guestId: GuestId.make(viewer) })]),
      ...(you === undefined ? [] : [roomMentionKey({ memberId: you.memberId })]),
    ],
    colorOf: (guestId) => boardCursorColor(guests, guestId),
  };
  return <BoardMentionsContext value={value}>{children}</BoardMentionsContext>;
}

const chipStyle = (color: string | undefined) =>
  color === undefined
    ? undefined
    : { color, backgroundColor: `color-mix(in oklab, ${color} 14%, transparent)` };

/** A mentioned name in its person's colour; one that is the viewer is outlined. */
function MentionChip({ mention }: { readonly mention: RoomBoardMention }) {
  const mentions = use(BoardMentionsContext);
  const me = mentions?.me.includes(roomMentionKey(mention)) === true;
  const color = mention.guestId === undefined ? undefined : mentions?.colorOf(mention.guestId);
  return (
    <span
      className={cn(
        "rounded-sm px-0.5 font-medium",
        color === undefined && "bg-muted text-foreground",
        me && "ring-1 ring-current",
      )}
      style={chipStyle(color)}
      data-mention={me ? "me" : ""}
    >
      @{mention.name}
    </span>
  );
}

/** Text with its mentions as chips. */
export function MentionText({
  text,
  mentions,
}: {
  readonly text: string;
  readonly mentions: ReadonlyArray<RoomBoardMention> | undefined;
}) {
  return (
    <>
      {mentionSegments(text, mentions).map((piece, index) =>
        piece.mention === undefined ? (
          piece.text
        ) : (
          // oxlint-disable-next-line react/no-array-index-key -- pieces have no id; the same name can come twice
          <MentionChip key={index} mention={piece.mention} />
        ),
      )}
    </>
  );
}

/** The people a card names, as a row of chips under its text. */
export function MentionChips({
  mentions,
}: {
  readonly mentions: ReadonlyArray<RoomBoardMention> | undefined;
}) {
  if (mentions === undefined || mentions.length === 0) return null;
  return (
    <p className="flex shrink-0 flex-wrap gap-1 px-3 pb-1.5 text-2xs" aria-label="Mentioned">
      {mentions.map((mention) => (
        <MentionChip key={roomMentionKey(mention)} mention={mention} />
      ))}
    </p>
  );
}

export interface MentionPick {
  readonly text: string;
  readonly mention: RoomBoardMention;
}

interface PickerState {
  readonly start: number;
  readonly caret: number;
  readonly query: string;
  readonly field: HTMLTextAreaElement;
  readonly rect: { readonly left: number; readonly top: number; readonly bottom: number };
}

/**
 * The `@` picker for one text field. Call `track` from its change handler and `keyDown` first in
 * its key handler; render `popup`. Arrows move, Enter or Tab picks, Escape closes.
 */
export function useMentionPicker(onPick: (picked: MentionPick) => void) {
  const mentions = use(BoardMentionsContext);
  const [state, setState] = useState<PickerState | null>(null);
  const [active, setActive] = useState(0);
  const options =
    state === null || mentions === null ? [] : rankMentionPeople(mentions.people, state.query);
  const open = options.length > 0;
  const shown = Math.min(active, Math.max(0, options.length - 1));

  const track = (field: HTMLTextAreaElement) => {
    if (mentions === null || mentions.people.length === 0) return;
    const caret = field.selectionStart ?? field.value.length;
    const found = mentionQueryAt(field.value, caret);
    if (found === null) {
      setState(null);
      return;
    }
    const { left, top, bottom } = field.getBoundingClientRect();
    if (state?.query !== found.query) setActive(0);
    setState({ ...found, caret, field, rect: { left, top, bottom } });
  };
  const pick = (person: MentionPerson) => {
    if (state === null) return;
    const { field } = state;
    const inserted = insertMention(field.value, state.start, state.caret, person.name);
    setState(null);
    onPick({ text: inserted.text, mention: mentionOf(person) });
    // The field takes the new text on the next render; the caret goes after the name then.
    setTimeout(() => {
      field.focus();
      field.setSelectionRange(inserted.caret, inserted.caret);
    }, 0);
  };
  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!open || event.nativeEvent.isComposing) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((shown + step + options.length) % options.length);
    } else if (event.key === "Enter" || event.key === "Tab") {
      const person = options[shown];
      if (person !== undefined) pick(person);
    } else if (event.key === "Escape") {
      setState(null);
    } else {
      return false;
    }
    event.preventDefault();
    event.stopPropagation();
    return true;
  };
  const below = state === null || state.rect.bottom < window.innerHeight - 220;
  // Inside a dialog, the list goes in it: a modal dialog takes no pointer outside itself.
  const dialog = state?.field.closest<HTMLElement>('[role="dialog"], [role="alertdialog"]') ?? null;
  const container = dialog ?? document.body;
  // A dialog that moves itself with a transform places fixed children from its own corner.
  const corner =
    dialog === null || getComputedStyle(dialog).transform === "none"
      ? null
      : dialog.getBoundingClientRect();
  const popup =
    !open || state === null
      ? null
      : createPortal(
          <ul
            role="listbox"
            aria-label="Mention someone"
            className="fixed z-[200] max-h-52 w-56 overflow-y-auto rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-lg"
            style={
              corner === null
                ? {
                    left: Math.min(state.rect.left, window.innerWidth - 232),
                    ...(below
                      ? { top: state.rect.bottom + 4 }
                      : { bottom: window.innerHeight - state.rect.top + 4 }),
                  }
                : { left: state.rect.left - corner.left, top: state.rect.bottom + 4 - corner.top }
            }
            // Keeps the caret in the field while a name is picked with the pointer.
            onPointerDown={(event) => event.preventDefault()}
            onMouseDown={(event) => event.preventDefault()}
            data-board-overlay
          >
            {options.map((person, index) => (
              <li
                key={person.key}
                role="option"
                aria-selected={index === shown}
                className={cn(
                  "flex cursor-pointer items-center gap-2 truncate rounded-sm px-2 py-1",
                  index === shown && "bg-accent text-accent-foreground",
                )}
                onPointerEnter={() => setActive(index)}
                // On press: the field's blur, or a dialog around it, can come before a click.
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  pick(person);
                }}
              >
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-full bg-muted-foreground"
                  style={
                    person.guestId === undefined || mentions === null
                      ? undefined
                      : { backgroundColor: mentions.colorOf(person.guestId) }
                  }
                />
                <span className="truncate">{person.name}</span>
                {person.guestId === undefined ? (
                  <span className="ms-auto shrink-0 text-2xs text-muted-foreground">Workspace</span>
                ) : null}
              </li>
            ))}
          </ul>,
          container,
        );
  return { open, track, keyDown, close: () => setState(null), popup };
}
