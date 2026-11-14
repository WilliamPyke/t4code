import { ArrowUpIcon, PinIcon, PinOffIcon, XIcon } from "lucide-react";
import { type PointerEvent, type ReactNode, useState } from "react";

import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  BOARD_PROMPT_MAX_CARDS,
  type BoardPrompt,
  type BoardPromptCard,
  boardPromptCardGoes,
} from "./roomBoard.logic";

const stopPointer = (event: PointerEvent) => event.stopPropagation();
const NONE: ReadonlySet<string> = new Set();
const PREVIEW_LENGTH = 240;

const without = (set: ReadonlySet<string>, ref: string) => {
  const next = new Set(set);
  next.delete(ref);
  return next;
};

/**
 * The prompt box on a thread box. Connected cards that are new, changed since they were last
 * sent, or pinned show as chips and go; one left out by hand stays out until the prompt goes.
 * Cards already sent wait under "N already sent", where one can be put back for this prompt or
 * pinned. Only the chips shown when Send is pressed go.
 */
export function BoardPromptBox({
  cards,
  artifact,
  label,
  placeholder,
  model,
  onPrompt,
  onPin,
}: {
  readonly cards: ReadonlyArray<BoardPromptCard>;
  /** The artifact the box has a line to, which the reply rewrites, or null. */
  readonly artifact: { readonly id: string; readonly title: string } | null;
  readonly label: string;
  readonly placeholder: string;
  /** Which model runs the prompt, and the way to change it. */
  readonly model?: ReactNode;
  readonly onPrompt: (prompt: BoardPrompt) => Promise<boolean>;
  /** Pins a card so it goes with every prompt, or unpins it. Absent for whoever cannot edit. */
  readonly onPin?: ((card: BoardPromptCard, pinned: boolean) => void) | undefined;
}) {
  const [text, setText] = useState("");
  const [leftOut, setLeftOut] = useState(NONE);
  const [putBack, setPutBack] = useState(NONE);
  const [showSent, setShowSent] = useState(false);
  const [sending, setSending] = useState(false);
  const goes = (card: BoardPromptCard) =>
    boardPromptCardGoes(card) ? !leftOut.has(card.ref) : putBack.has(card.ref);
  const attached = cards.filter(goes).slice(0, BOARD_PROMPT_MAX_CARDS);
  const hidden = cards.filter((card) => boardPromptCardGoes(card) && leftOut.has(card.ref)).length;
  const waiting = cards.filter((card) => !boardPromptCardGoes(card) && !putBack.has(card.ref));
  const send = async () => {
    const message = text.trim();
    if (message === "" || sending) return;
    setSending(true);
    const sent = await onPrompt({
      text: message,
      cards: attached,
      artifactId: artifact?.id ?? null,
    }).catch(() => false);
    setSending(false);
    if (sent) {
      setText("");
      setLeftOut(NONE);
      setPutBack(NONE);
    }
  };
  const pinButton = (card: BoardPromptCard) => {
    if (onPin === undefined) return null;
    const pinned = card.status === "pinned";
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              aria-label={
                pinned ? `Stop always sending ${card.label}` : `Always send ${card.label}`
              }
              aria-pressed={pinned}
              className="grid size-5 shrink-0 place-items-center rounded-full opacity-60 hover:opacity-100"
              onClick={() => onPin(card, !pinned)}
            />
          }
        >
          {pinned ? <PinOffIcon className="size-3" /> : <PinIcon className="size-3" />}
        </TooltipTrigger>
        <TooltipPopup side="top">
          {pinned ? "Stop always sending" : "Always send with this box's prompts"}
        </TooltipPopup>
      </Tooltip>
    );
  };
  const leave = (card: BoardPromptCard) =>
    boardPromptCardGoes(card)
      ? setLeftOut((current) => new Set(current).add(card.ref))
      : setPutBack((current) => without(current, card.ref));
  const shown = attached.length + hidden + waiting.length;
  return (
    <div className="flex flex-col gap-1.5" data-board-prompt onPointerDown={stopPointer}>
      {shown === 0 ? null : (
        <div className="flex flex-col gap-1">
          <p className="text-2xs text-muted-foreground">
            {attached.length === 0
              ? "No connected cards go with the next prompt."
              : "Goes with the next prompt"}
          </p>
          <ul className="flex flex-wrap gap-1">
            {attached.map((card) => (
              <li
                key={card.ref}
                data-card-status={card.status ?? "new"}
                className="flex max-w-full min-w-0 items-center gap-0.5 rounded-md bg-primary/10 ps-1.5 text-2xs font-medium dark:bg-primary/18"
              >
                <Tooltip>
                  <TooltipTrigger render={<span className="flex min-w-0 items-center gap-1" />}>
                    {card.status === "pinned" ? (
                      <PinIcon aria-label="Always sent" className="size-3 shrink-0 text-primary" />
                    ) : null}
                    <span className="min-w-0 truncate">
                      {card.label}
                      {card.excerpt === "" ? null : (
                        <span className="font-normal text-muted-foreground">: {card.excerpt}</span>
                      )}
                    </span>
                    {card.status === "updated" ? (
                      <span className="shrink-0 text-muted-foreground">· updated</span>
                    ) : null}
                  </TooltipTrigger>
                  <TooltipPopup side="top">
                    {card.status === "updated" ? (
                      <p className="mb-1 text-muted-foreground">Changed since it was last sent.</p>
                    ) : null}
                    <p className="max-w-64 whitespace-pre-line [overflow-wrap:anywhere]">
                      {card.text.length > PREVIEW_LENGTH
                        ? `${card.text.slice(0, PREVIEW_LENGTH).trimEnd()}…`
                        : card.text}
                    </p>
                  </TooltipPopup>
                </Tooltip>
                {pinButton(card)}
                <button
                  type="button"
                  aria-label={`Leave out ${card.label}`}
                  className="grid size-5 shrink-0 place-items-center rounded-full opacity-60 hover:opacity-100"
                  onClick={() => leave(card)}
                >
                  <XIcon className="size-3" />
                </button>
              </li>
            ))}
            {hidden === 0 ? null : (
              <li>
                <Button size="micro" variant="ghost-muted" onClick={() => setLeftOut(NONE)}>
                  Put back {hidden} left out
                </Button>
              </li>
            )}
            {waiting.length === 0 ? null : (
              <li className="flex">
                <button
                  type="button"
                  aria-expanded={showSent}
                  className="rounded-md border border-dashed border-foreground/20 px-1.5 py-0.5 text-2xs text-muted-foreground hover:border-foreground/35 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none"
                  onClick={() => setShowSent((current) => !current)}
                >
                  {waiting.length} already sent
                </button>
              </li>
            )}
          </ul>
          {!showSent || waiting.length === 0 ? null : (
            <div className="flex flex-col gap-0.5 rounded-md border border-dashed border-foreground/15 p-1.5">
              <p className="text-2xs text-muted-foreground">
                Sent with an earlier prompt. They go again once they change.
              </p>
              <ul className="flex flex-col gap-0.5">
                {waiting.map((card) => (
                  <li key={card.ref} className="flex min-w-0 items-center gap-1 text-2xs">
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">
                      {card.label}
                      {card.excerpt === "" ? null : `: ${card.excerpt}`}
                    </span>
                    <Button
                      size="micro"
                      variant="ghost-muted"
                      onClick={() => setPutBack((current) => new Set(current).add(card.ref))}
                    >
                      Send again
                    </Button>
                    {onPin === undefined ? null : (
                      <Button size="micro" variant="ghost-muted" onClick={() => onPin(card, true)}>
                        <PinIcon />
                        Always send
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      <Textarea
        size="sm"
        rows={2}
        aria-label={label}
        placeholder={placeholder}
        value={text}
        data-box-prompt
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
      {artifact === null ? null : (
        <p className="truncate text-2xs text-muted-foreground">
          {`Replies rewrite "${artifact.title.trim() === "" ? "Untitled artifact" : artifact.title.trim()}"`}
        </p>
      )}
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center">{model}</div>
        <Button
          size="icon-xs"
          aria-label={sending ? "Sending..." : "Send"}
          disabled={sending || text.trim() === ""}
          onClick={() => void send()}
        >
          <ArrowUpIcon />
        </Button>
      </div>
    </div>
  );
}
