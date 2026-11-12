import {
  ROOM_BOARD_MAX_NOTES,
  ROOM_BOARD_NOTE_MAX_LENGTH,
  type RoomBoard,
  type RoomBoardChange,
} from "@t3tools/contracts";
import { MessageSquarePlusIcon, MessageSquareTextIcon, XIcon } from "lucide-react";
import { createContext, type ReactNode, use, useState } from "react";
import { create } from "zustand";

import { cn, randomUUID } from "~/lib/utils";

import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  type BoardPeople,
  boardPersonName,
  boardReplyQuote,
  pinnedCommentSpot,
} from "./roomBoard.logic";

/**
 * Which reply the board asked to see, until the timeline that has it scrolls to it, and which
 * reply this person is writing a comment on.
 */
export const useRoomReplies = create<{
  readonly reveal: string | null;
  readonly commenting: string | null;
}>(() => ({ reveal: null, commenting: null }));
export const revealRoomReply = (messageId: string) =>
  useRoomReplies.setState({ reveal: messageId });
export const roomReplyRevealed = () => useRoomReplies.setState({ reveal: null });
const commentOn = (messageId: string | null) => useRoomReplies.setState({ commenting: messageId });

/** A shared thread's room, as the comments pinned to its replies need it. */
export interface RoomReplyRoom {
  readonly board: RoomBoard;
  readonly people: BoardPeople;
  /** Sends one change to the room and says whether it was taken. Absent when they may not. */
  readonly onChange: ((change: RoomBoardChange) => Promise<boolean>) | undefined;
}

const RoomReplyContext = createContext<RoomReplyRoom | null>(null);

/** Gives a timeline the room of its thread. Without one, replies take no comments. */
export function RoomReplyProvider({
  room,
  children,
}: {
  readonly room: RoomReplyRoom | null;
  readonly children: ReactNode;
}) {
  return <RoomReplyContext value={room}>{children}</RoomReplyContext>;
}

const canComment = (
  room: RoomReplyRoom | null,
): room is RoomReplyRoom & {
  readonly onChange: (change: RoomBoardChange) => Promise<boolean>;
} => room?.onChange !== undefined && room.board.notes.length < ROOM_BOARD_MAX_NOTES;

/** Starts a comment on a reply, beside its other actions. Shown only in a shared thread. */
export function RoomReplyCommentButton({ messageId }: { readonly messageId: string }) {
  const room = use(RoomReplyContext);
  if (!canComment(room)) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon-xs"
            variant="ghost-muted"
            aria-label="Comment for the room"
            onClick={() => commentOn(messageId)}
          />
        }
      >
        <MessageSquarePlusIcon className="size-3" />
      </TooltipTrigger>
      <TooltipPopup>Comment for the room</TooltipPopup>
    </Tooltip>
  );
}

/**
 * The room's comments on one reply, and the one being written. A comment is a note on the
 * board: everyone in the room sees it, and no agent does.
 */
export function RoomReplyComments({
  messageId,
  text,
  align,
}: {
  readonly messageId: string;
  /** The reply's text, which a new comment quotes the start of so the board shows what it is on. */
  readonly text?: string | undefined;
  readonly align: "start" | "end";
}) {
  const room = use(RoomReplyContext);
  const writing = useRoomReplies((state) => state.commenting === messageId);
  if (room === null) return null;
  const pinned = room.board.notes.filter((note) => note.pinnedTo === messageId);
  const { onChange } = room;
  if (pinned.length === 0 && !writing) return null;
  return (
    <div
      className={cn("flex flex-col gap-1 px-1 pt-1", align === "end" ? "items-end" : "items-start")}
    >
      {pinned.map((note) => (
        <div
          key={note.id}
          className="flex max-w-[80%] items-start gap-1.5 rounded-md border border-warning/40 bg-warning-surface py-1 ps-2 pe-1 text-xs text-foreground"
        >
          <MessageSquareTextIcon aria-hidden className="mt-0.5 size-3 shrink-0 opacity-60" />
          <p className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">
            <span className="font-medium">{boardPersonName(room.people, note.guestId)}</span>{" "}
            {note.text}
          </p>
          {onChange === undefined ? null : (
            <button
              type="button"
              aria-label="Delete comment"
              className="grid size-4 shrink-0 place-items-center rounded-sm opacity-60 hover:opacity-100"
              onClick={() => void onChange({ type: "note.remove", noteId: note.id })}
            >
              <XIcon className="size-3" />
            </button>
          )}
        </div>
      ))}
      {writing && canComment(room) ? (
        <CommentForm room={room} messageId={messageId} reply={text} />
      ) : null}
    </div>
  );
}

function CommentForm({
  room,
  messageId,
  reply,
}: {
  readonly room: RoomReplyRoom & {
    readonly onChange: (change: RoomBoardChange) => Promise<boolean>;
  };
  readonly messageId: string;
  readonly reply: string | undefined;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const trimmed = text.trim();
    if (trimmed === "" || busy) return;
    setBusy(true);
    const at = pinnedCommentSpot(room.board);
    const quote = reply === undefined ? "" : boardReplyQuote(reply);
    const taken = await room.onChange({
      type: "note.put",
      noteId: randomUUID(),
      text: trimmed,
      x: at.x,
      y: at.y,
      pinnedTo: messageId,
      ...(quote === "" ? {} : { quote }),
    });
    setBusy(false);
    if (taken) commentOn(null);
  };
  return (
    <form
      className="flex w-full max-w-[80%] flex-col gap-1.5 rounded-md border border-border bg-card p-2"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <textarea
        aria-label="Comment"
        autoFocus
        rows={2}
        value={text}
        maxLength={ROOM_BOARD_NOTE_MAX_LENGTH}
        placeholder="Comment for the room. Agents never see it."
        className="resize-none bg-transparent text-xs outline-none placeholder:text-placeholder"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") commentOn(null);
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void save();
          }
        }}
      />
      <div className="flex justify-end gap-1">
        <Button size="xs" variant="ghost" onClick={() => commentOn(null)}>
          Cancel
        </Button>
        <Button size="xs" type="submit" disabled={busy || text.trim() === ""}>
          Comment
        </Button>
      </div>
    </form>
  );
}
