import { BotIcon, SendHorizontalIcon, XIcon } from "lucide-react";
import { type PointerEvent, useState } from "react";

import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { BoardPrompt, BoardPromptCard } from "./roomBoard.logic";

const stopPointer = (event: PointerEvent) => event.stopPropagation();
const NONE_LEFT_OUT: ReadonlySet<string> = new Set();
const PREVIEW_LENGTH = 240;

/**
 * The box on the thread's card, or on an artifact card, that sends a message from the board. The
 * cards connected to it by arrows show as chips and go with every message; one left out stays out
 * until the message goes.
 */
export function BoardPromptBox({
  cards,
  artifactId,
  fills,
  label,
  placeholder,
  onPrompt,
  onTake,
}: {
  readonly cards: ReadonlyArray<BoardPromptCard>;
  /** The artifact the reply fills, or null. */
  readonly artifactId: string | null;
  /** The title of that artifact, said under the box, when an arrow from this card chose it. */
  readonly fills: string | null;
  readonly label: string;
  readonly placeholder: string;
  readonly onPrompt: (prompt: BoardPrompt) => Promise<boolean>;
  /** Opens the message as a draft for the viewer's own agent. The box keeps its text. */
  readonly onTake?: ((prompt: BoardPrompt) => void) | undefined;
}) {
  const [text, setText] = useState("");
  const [leftOut, setLeftOut] = useState(NONE_LEFT_OUT);
  const [sending, setSending] = useState(false);
  const attached = cards.filter((card) => !leftOut.has(card.ref));
  const hidden = cards.length - attached.length;
  const prompt = (): BoardPrompt | null => {
    const message = text.trim();
    return message === "" ? null : { text: message, cards: attached, artifactId };
  };
  const send = async () => {
    const message = prompt();
    if (message === null || sending) return;
    setSending(true);
    const sent = await onPrompt(message).catch(() => false);
    setSending(false);
    if (sent) {
      setText("");
      setLeftOut(NONE_LEFT_OUT);
    }
  };
  const take = () => {
    const message = prompt();
    if (message !== null) onTake?.(message);
  };
  return (
    <div className="flex flex-col gap-1.5" onPointerDown={stopPointer}>
      {attached.length === 0 && hidden === 0 ? null : (
        <div className="flex flex-col gap-1">
          <p className="text-2xs text-muted-foreground">
            {attached.length === 0
              ? "No connected cards go with this message."
              : "Connected cards go with each message:"}
          </p>
          <ul className="flex flex-wrap gap-1">
            {attached.map((card) => (
              <li
                key={card.ref}
                className="flex max-w-full min-w-0 items-center gap-0.5 rounded-full border border-info/40 bg-info/8 ps-2 text-2xs"
              >
                <Tooltip>
                  <TooltipTrigger render={<span className="min-w-0 truncate" />}>
                    {card.label}
                  </TooltipTrigger>
                  <TooltipPopup side="top">
                    <p className="max-w-64 whitespace-pre-line [overflow-wrap:anywhere]">
                      {card.text.length > PREVIEW_LENGTH
                        ? `${card.text.slice(0, PREVIEW_LENGTH).trimEnd()}…`
                        : card.text}
                    </p>
                  </TooltipPopup>
                </Tooltip>
                <button
                  type="button"
                  aria-label={`Leave out ${card.label}`}
                  className="grid size-5 shrink-0 place-items-center rounded-full opacity-60 hover:opacity-100"
                  onClick={() => setLeftOut((current) => new Set(current).add(card.ref))}
                >
                  <XIcon className="size-3" />
                </button>
              </li>
            ))}
            {hidden === 0 ? null : (
              <li>
                <Button
                  size="micro"
                  variant="ghost-muted"
                  onClick={() => setLeftOut(NONE_LEFT_OUT)}
                >
                  Put back {hidden} left out
                </Button>
              </li>
            )}
          </ul>
        </div>
      )}
      <Textarea
        size="sm"
        rows={2}
        aria-label={label}
        placeholder={placeholder}
        value={text}
        // Read-only rather than disabled while it sends, so the box keeps focus.
        readOnly={sending}
        aria-busy={sending}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          // As in the app composer: Enter sends, Shift+Enter adds a line.
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            void send();
          }
        }}
      />
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">
          {fills === null
            ? null
            : `Arrow to "${fills.trim() === "" ? "Untitled artifact" : fills.trim()}": replies fill it`}
        </p>
        {onTake === undefined ? null : (
          <Button size="xs" variant="outline" disabled={text.trim() === ""} onClick={take}>
            <BotIcon />
            Take to my agent
          </Button>
        )}
        <Button size="xs" disabled={sending || text.trim() === ""} onClick={() => void send()}>
          <SendHorizontalIcon />
          {sending ? "Sending..." : "Send"}
        </Button>
      </div>
    </div>
  );
}
