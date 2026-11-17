import * as Schema from "effect/Schema";
import { XIcon } from "lucide-react";
import { useState } from "react";

import { getLocalStorageItem, setLocalStorageItem } from "~/hooks/useLocalStorage";

import { BoardFloat } from "../room/BoardChrome";
import { Button } from "../ui/button";

// Per browser, and per account signed in on it: the tips were seen or skipped.
const coachKey = (accountId: string | undefined) =>
  `t3code:board-coach:v1:${accountId ?? "browser"}`;

const readSeen = (key: string) => {
  try {
    return getLocalStorageItem(key, Schema.Boolean) === true;
  } catch {
    return false;
  }
};

const TIPS = [
  {
    title: "Add a note",
    body: "Double-click anywhere on the board, or pick Note below. Paste a link to show a Figma file or a doc right on the board.",
  },
  {
    title: "Give an agent context",
    body: "Drag from the dot on a card's edge to an agent's box. The agent reads what the line joins.",
  },
  {
    title: "Bring your agent",
    body: "Agents run on each person's own computer, so nobody else can start yours. Bring yours to add agent boxes here.",
  },
] as const;

/**
 * Three short tips on a person's first cloud board, one at a time in a corner, never over the
 * board's middle. Shown once; closing it at any tip counts as seen.
 */
export function BoardCoach({
  accountId,
  onBringAgent,
}: {
  readonly accountId: string | undefined;
  /** Opens how to bring their agent; absent once their agent is here. */
  readonly onBringAgent: (() => void) | undefined;
}) {
  const key = coachKey(accountId);
  const [seen, setSeen] = useState(() => readSeen(key));
  const [step, setStep] = useState(0);
  if (seen) return null;
  const finish = () => {
    setSeen(true);
    try {
      setLocalStorageItem(key, true, Schema.Boolean);
    } catch {}
  };
  const tip = TIPS[step]!;
  const last = step === TIPS.length - 1;
  return (
    <BoardFloat
      role="dialog"
      aria-label="Tips for this board"
      className="fixed end-4 bottom-20 z-30 w-72 flex-col items-stretch gap-2 p-3"
      data-board-coach
    >
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-sm font-semibold">{tip.title}</p>
        <span className="text-xs text-muted-foreground">
          {step + 1} of {TIPS.length}
        </span>
        <Button size="icon-xs" variant="ghost-muted" aria-label="Close tips" onClick={finish}>
          <XIcon />
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">{tip.body}</p>
      <div className="flex justify-end gap-1.5">
        {last && onBringAgent !== undefined ? (
          <Button
            size="xs"
            variant="outline"
            onClick={() => {
              finish();
              onBringAgent();
            }}
          >
            Bring my agent
          </Button>
        ) : null}
        <Button size="xs" onClick={last ? finish : () => setStep(step + 1)} data-board-coach-next>
          {last ? "Done" : "Next"}
        </Button>
      </div>
    </BoardFloat>
  );
}
