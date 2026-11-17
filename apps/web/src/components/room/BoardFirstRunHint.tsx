import * as Schema from "effect/Schema";
import { BotIcon, ClipboardPasteIcon, MousePointerClickIcon, SplineIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { getLocalStorageItem, setLocalStorageItem } from "~/hooks/useLocalStorage";
import { readBoardAccountProfile } from "~/guest/boardAccount";

import { Button } from "../ui/button";
import { BoardFloat } from "./BoardChrome";

// Seen on this browser, or by the account signed in on it. The two older tips' keys count too.
const SEEN_KEY = "t3code:board-first-run:v1";
const OLDER_KEYS = ["t3code.roomBoardHintDismissed", "t3code:board-coach:v1"] as const;
const seenKeys = (accountId: string | null) => [
  `${SEEN_KEY}:browser`,
  ...(accountId === null ? [] : [`${SEEN_KEY}:${accountId}`]),
];

const readFlag = (key: string) => {
  try {
    return getLocalStorageItem(key, Schema.Boolean) === true;
  } catch {
    return false;
  }
};

const wasSeen = (accountId: string | null) =>
  [
    ...seenKeys(accountId),
    OLDER_KEYS[0],
    `${OLDER_KEYS[1]}:browser`,
    ...(accountId === null ? [] : [`${OLDER_KEYS[1]}:${accountId}`]),
  ].some(readFlag);

const TIPS = [
  { icon: MousePointerClickIcon, text: "Double-click the board for a note, or pick Note below." },
  {
    icon: SplineIcon,
    text: "Drag from the dot on a card's edge to another card. An agent reads what its lines join.",
  },
  { icon: ClipboardPasteIcon, text: "Paste a link to show a Figma file or a doc on the board." },
] as const;

/**
 * The board's one first-run card: how to add, join and embed, and how to bring an agent. Shown
 * once per person, on the first board they open in the Board view; seen counts once it shows.
 */
export function BoardFirstRunHint({
  bringAgent,
  hidden,
}: {
  /** Opens how to bring this person's agent; absent once it is here or the board takes none. */
  readonly bringAgent: (() => void) | undefined;
  /** Out of the way for now, as in the Plan, and still to show when it comes back. */
  readonly hidden: boolean;
}) {
  const [accountId] = useState(() => readBoardAccountProfile()?.userId ?? null);
  const [shown, setShown] = useState(() => !wasSeen(accountId));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- marks the tips seen in this browser's storage once they have shown
  useEffect(() => {
    if (!shown || hidden) return;
    for (const key of seenKeys(accountId)) {
      try {
        setLocalStorageItem(key, true, Schema.Boolean);
      } catch {}
    }
  }, [accountId, shown, hidden]);
  if (!shown || hidden) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-20 z-30 flex justify-center px-4">
      <BoardFloat
        role="note"
        aria-label="Getting started"
        className="pointer-events-auto w-full max-w-md flex-col items-stretch gap-2 p-3"
        data-board-first-run
      >
        <p className="text-sm font-semibold">Getting started</p>
        <ul className="flex flex-col gap-1.5 text-xs text-muted-foreground">
          {TIPS.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-start gap-2">
              <Icon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-primary" />
              {text}
            </li>
          ))}
          {bringAgent === undefined ? null : (
            <li className="flex items-start gap-2">
              <BotIcon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-primary" />
              Agents run on each person's own computer, so nobody else can start yours.
            </li>
          )}
        </ul>
        <div className="flex justify-end gap-1.5">
          {bringAgent === undefined ? null : (
            <Button
              size="xs"
              variant="outline"
              onClick={() => {
                setShown(false);
                bringAgent();
              }}
            >
              Bring my agent
            </Button>
          )}
          <Button size="xs" onClick={() => setShown(false)}>
            Got it
          </Button>
        </div>
      </BoardFloat>
    </div>
  );
}
