import { SendHorizontalIcon, XIcon } from "lucide-react";
import { type PointerEvent, type ReactNode, useState } from "react";

import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { BoardPrompt, BoardPromptCard } from "./roomBoard.logic";

const stopPointer = (event: PointerEvent) => event.stopPropagation();
const NONE_LEFT_OUT: ReadonlySet<string> = new Set();
const PREVIEW_LENGTH = 240;

/**
 * The prompt box on a thread box. The cards connected to the box by lines show as chips and go
 * with every prompt; one left out stays out until the prompt goes. Only the chips shown when Send
 * is pressed go.
 */
export function BoardPromptBox({
  cards,
  artifact,
  label,
  placeholder,
  model,
  onPrompt,
}: {
  readonly cards: ReadonlyArray<BoardPromptCard>;
  /** The artifact the box has a line to, which the reply rewrites, or null. */
  readonly artifact: { readonly id: string; readonly title: string } | null;
  readonly label: string;
  readonly placeholder: string;
  /** Which model runs the prompt, and the way to change it. */
  readonly model?: ReactNode;
  readonly onPrompt: (prompt: BoardPrompt) => Promise<boolean>;
}) {
  const [text, setText] = useState("");
  const [leftOut, setLeftOut] = useState(NONE_LEFT_OUT);
  const [sending, setSending] = useState(false);
  const attached = cards.filter((card) => !leftOut.has(card.ref));
  const hidden = cards.length - attached.length;
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
      setLeftOut(NONE_LEFT_OUT);
    }
  };
  return (
    <div className="flex flex-col gap-1.5" onPointerDown={stopPointer}>
      {attached.length === 0 && hidden === 0 ? null : (
        <div className="flex flex-col gap-1">
          <p className="text-2xs text-muted-foreground">
            {attached.length === 0
              ? "No connected cards go with this prompt."
              : "Connected cards go with each prompt:"}
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
                    {card.excerpt === "" ? null : (
                      <span className="text-muted-foreground">: {card.excerpt}</span>
                    )}
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
        <p className="truncate text-2xs text-success">
          {`Replies rewrite "${artifact.title.trim() === "" ? "Untitled artifact" : artifact.title.trim()}"`}
        </p>
      )}
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center">{model}</div>
        <Button size="xs" disabled={sending || text.trim() === ""} onClick={() => void send()}>
          <SendHorizontalIcon />
          {sending ? "Sending..." : "Send"}
        </Button>
      </div>
    </div>
  );
}
