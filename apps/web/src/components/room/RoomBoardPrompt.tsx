import { ArrowUpIcon, FrameIcon, PinIcon, PinOffIcon, XIcon } from "lucide-react";
import { type PointerEvent, type ReactNode, useState } from "react";

import { boardTimeLabel } from "../boards/boardsHome.logic";
import { Button } from "../ui/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  BOARD_PROMPT_MAX_CARDS,
  type BoardPrompt,
  type BoardPromptCard,
  type BoardPromptSectionChip,
  boardPromptCardGoes,
  boardPromptChips,
} from "./roomBoard.logic";

const stopPointer = (event: PointerEvent) => event.stopPropagation();
const NONE: ReadonlySet<string> = new Set();
const PREVIEW_LENGTH = 240;

/** An artifact a box can rewrite, and when the version it shows was written, if it has one. */
interface BoardPromptArtifact {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: string | undefined;
}
const NO_ARTIFACTS: ReadonlyArray<BoardPromptArtifact> = [];
const artifactName = (artifact: Pick<BoardPromptArtifact, "title">) =>
  artifact.title.trim() === "" ? "Untitled artifact" : artifact.title.trim();

const cardChangeMark = (card: BoardPromptCard): string | null => {
  const by = card.changedBy ?? card.editedBy;
  if (by !== undefined) return ` · changed by ${by}`;
  return card.status === "updated" ? " · updated" : null;
};

/** What a chip's tooltip says of where its card came from and who changed it. */
const cardProvenance = (card: BoardPromptCard): ReadonlyArray<string> => [
  ...(card.changedBy !== undefined
    ? [`${card.changedBy} changed it since it last went with a prompt.`]
    : card.status === "updated"
      ? ["Changed since it was last sent."]
      : []),
  ...(card.editedBy === undefined || card.editedBy === card.changedBy
    ? []
    : [`Last changed by ${card.editedBy}.`]),
  ...(card.addedBy === undefined ? [] : [`${card.addedBy} connected it to this box.`]),
];

const without = (set: ReadonlySet<string>, ref: string) => {
  const next = new Set(set);
  next.delete(ref);
  return next;
};

/**
 * A prompt the board wrote for its owner to read and send, such as one bringing a link in. It only
 * fills the field: nothing goes until they press Send, and they can change or drop it.
 */
export interface BoardPromptDraft {
  /** New each time it is prepared, so preparing it again puts its text back. */
  readonly key: string;
  readonly text: string;
  /** The cards that go with it, in place of the box's connected ones. */
  readonly cards: ReadonlyArray<BoardPromptCard>;
  /** What it is for, said above the field. */
  readonly title: string;
  /** Where the reply goes, said below the field. */
  readonly fills: string;
  readonly onSend: (prompt: BoardPrompt) => Promise<boolean>;
  readonly onCancel: () => void;
}

/**
 * The prompt box on a thread box. Connected cards that are new, changed since last sent, or pinned
 * show as chips and go, a section's as one; one left out stays out until the prompt goes. Cards
 * already sent wait under "N already sent", to put back or pin. Only the chips shown at Send go.
 */
export function BoardPromptBox({
  cards: connected,
  artifact,
  label,
  placeholder,
  model,
  onPrompt,
  onPin,
  summary,
  draft,
  artifacts = NO_ARTIFACTS,
  onPickArtifact,
}: {
  /** The box's connected notes in a few words: "3 notes: 2 done, 1 to send". */
  readonly summary?: string | null | undefined;
  /** Every artifact the box has a line to, to pick which one the reply rewrites among several. */
  readonly artifacts?: ReadonlyArray<BoardPromptArtifact>;
  readonly onPickArtifact?: ((artifactId: string) => void) | undefined;
  /** A prompt prepared for this box, shown in its field until sent or dropped. */
  readonly draft?: BoardPromptDraft | undefined;
  readonly cards: ReadonlyArray<BoardPromptCard>;
  /** The artifact the reply rewrites, among those the box has a line to, or null. */
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
  // When the box was drawn: a version's age is said in words, as its card says it.
  const [now] = useState(() => Date.now());
  // A prepared prompt fills the field once per preparation; dropping it empties the field.
  const [draftKey, setDraftKey] = useState<string | null>(null);
  if ((draft?.key ?? null) !== draftKey) {
    setDraftKey(draft?.key ?? null);
    setText(draft?.text ?? "");
    setLeftOut(NONE);
    setPutBack(NONE);
  }
  const cards = draft?.cards ?? connected;
  const goes = (card: BoardPromptCard) =>
    boardPromptCardGoes(card) ? !leftOut.has(card.ref) : putBack.has(card.ref);
  const attached = cards.filter(goes).slice(0, BOARD_PROMPT_MAX_CARDS);
  const hidden = cards.filter((card) => boardPromptCardGoes(card) && leftOut.has(card.ref)).length;
  const waiting = cards.filter((card) => !boardPromptCardGoes(card) && !putBack.has(card.ref));
  const send = async () => {
    const message = text.trim();
    if (message === "" || sending) return;
    setSending(true);
    const sent = await (draft?.onSend ?? onPrompt)({
      text: message,
      cards: attached,
      artifactId: draft === undefined ? (artifact?.id ?? null) : null,
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
  const chips = boardPromptChips(attached);
  const sectionChip = ({ section, first, cards: group }: BoardPromptSectionChip) => {
    const title = section.title === "" ? "Untitled section" : section.title;
    const pinned = group.every((card) => card.status === "pinned");
    const changed = group.find((card) => card.changedBy !== undefined);
    const label = `${title} (${group.length} cards)`;
    // Pinning the chip pins the section's line, so every card in it goes with every prompt.
    const line: BoardPromptCard = {
      ...first,
      label,
      status: pinned ? "pinned" : "new",
      edgeIds: section.edgeIds,
    };
    return (
      <li
        key={section.ref}
        data-card-status={pinned ? "pinned" : "new"}
        className="flex max-w-full min-w-0 items-center gap-0.5 rounded-full bg-primary/10 ps-2 text-2xs font-medium dark:bg-primary/18"
      >
        <Tooltip>
          <TooltipTrigger render={<span className="flex min-w-0 items-center gap-1" />}>
            {pinned ? (
              <PinIcon aria-label="Always sent" className="size-3 shrink-0 text-primary" />
            ) : (
              <FrameIcon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 truncate">
              {title}
              <span className="font-normal text-muted-foreground"> ({group.length} cards)</span>
            </span>
            {changed === undefined ? null : (
              <span className="shrink-0 text-warning-foreground">
                · changed by {changed.changedBy}
              </span>
            )}
          </TooltipTrigger>
          <TooltipPopup side="top">
            <p className="mb-1 text-muted-foreground">Every card in this section goes.</p>
            <ul className="max-w-64">
              {group.map((card) => (
                <li key={card.ref} className="truncate">
                  {card.label}
                  {card.excerpt === "" ? null : `: ${card.excerpt}`}
                  {cardChangeMark(card)}
                  {card.addedBy === undefined ? null : ` · added by ${card.addedBy}`}
                </li>
              ))}
            </ul>
          </TooltipPopup>
        </Tooltip>
        {pinButton(line)}
        <button
          type="button"
          aria-label={`Leave out ${label}`}
          className="grid size-5 shrink-0 place-items-center rounded-full opacity-60 hover:opacity-100"
          onClick={() => {
            for (const card of group) leave(card);
          }}
        >
          <XIcon className="size-3" />
        </button>
      </li>
    );
  };
  return (
    <div className="flex flex-col gap-1.5" data-board-prompt onPointerDown={stopPointer}>
      {draft === undefined ? null : (
        <div className="flex min-w-0 items-center gap-1" data-board-prompt-draft>
          <p className="min-w-0 flex-1 truncate text-2xs font-medium">{draft.title}</p>
          <Button size="micro" variant="ghost-muted" onClick={draft.onCancel}>
            Drop
          </Button>
        </div>
      )}
      {shown === 0 ? null : (
        <div className="flex flex-col gap-1">
          <p className="flex flex-wrap justify-between gap-x-2 text-2xs text-muted-foreground">
            <span>
              {attached.length === 0
                ? "No connected cards go with the next prompt."
                : "Goes with the next prompt"}
            </span>
            {summary == null || draft !== undefined ? null : (
              <span data-notes-summary>{summary}</span>
            )}
          </p>
          <ul className="flex flex-wrap gap-1">
            {chips.map((chip) => {
              if ("section" in chip) return sectionChip(chip);
              const { card } = chip;
              return (
                <li
                  key={card.ref}
                  data-card-status={card.status ?? "new"}
                  className="flex max-w-full min-w-0 items-center gap-0.5 rounded-full bg-primary/10 ps-2 text-2xs font-medium dark:bg-primary/18"
                >
                  <Tooltip>
                    <TooltipTrigger render={<span className="flex min-w-0 items-center gap-1" />}>
                      {card.status === "pinned" ? (
                        <PinIcon
                          aria-label="Always sent"
                          className="size-3 shrink-0 text-primary"
                        />
                      ) : null}
                      <span className="min-w-0 truncate">
                        {card.label}
                        {card.excerpt === "" ? null : (
                          <span className="font-normal text-muted-foreground">
                            : {card.excerpt}
                          </span>
                        )}
                      </span>
                      {card.changedBy !== undefined ? (
                        <span className="shrink-0 text-warning-foreground">
                          · changed by {card.changedBy}
                        </span>
                      ) : card.editedBy !== undefined ? (
                        <span className="shrink-0 text-muted-foreground">
                          · changed by {card.editedBy}
                        </span>
                      ) : card.status === "updated" ? (
                        <span className="shrink-0 text-muted-foreground">· updated</span>
                      ) : null}
                      {card.addedBy === undefined ? null : (
                        <span className="shrink-0 text-muted-foreground">
                          · added by {card.addedBy}
                        </span>
                      )}
                    </TooltipTrigger>
                    <TooltipPopup side="top">
                      {cardProvenance(card).map((line) => (
                        <p key={line} className="mb-1 text-muted-foreground">
                          {line}
                        </p>
                      ))}
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
              );
            })}
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
        rows={draft === undefined ? 2 : 6}
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
      {draft !== undefined ? (
        <p className="truncate text-2xs text-muted-foreground">{draft.fills}</p>
      ) : artifact === null ? null : artifacts.length < 2 || onPickArtifact === undefined ? (
        <p className="truncate text-2xs text-muted-foreground">
          {`Replies rewrite "${artifactName(artifact)}"`}
        </p>
      ) : (
        <div className="flex min-w-0 items-center gap-1.5" data-reply-card>
          <span className="shrink-0 text-2xs text-muted-foreground">Reply goes into</span>
          <div className="min-w-0 flex-1">
            <Select
              value={artifact.id}
              onValueChange={(next) => {
                if (next !== null) onPickArtifact(next);
              }}
            >
              <SelectTrigger size="xs" aria-label="Reply goes into">
                <SelectValue>{artifactName(artifact)}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="start" alignItemWithTrigger={false}>
                {artifacts.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {artifactName(option)}
                    <span className="text-muted-foreground">
                      {" · "}
                      {option.updatedAt === undefined
                        ? "empty"
                        : (boardTimeLabel(option.updatedAt, now)?.toLowerCase() ?? "written")}
                    </span>
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
        </div>
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
