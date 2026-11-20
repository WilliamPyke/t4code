import * as Schema from "effect/Schema";

import {
  getLocalStorageItem,
  readLocalStorageValue,
  removeLocalStorageItem,
  useLocalStorage,
  writeLocalStorageValue,
} from "~/hooks/useLocalStorage";

import { type BoardGuideStepId, boardGuideAfterSignIn } from "./boardGuide.logic";

// Per browser, for the one person using it now (`owner`): the first-run guide's steps done, and
// whether it is hidden or folded to its pill.
const GUIDE_KEY = "t3code:board-guide:v2";
// Kept before the guide knew whose it was: dropped, since it may be an earlier account's.
const LEGACY_GUIDE_KEY = "t3code:board-guide:v1";
const GuideState = Schema.Struct({
  owner: Schema.NullOr(Schema.String),
  hidden: Schema.Boolean,
  collapsed: Schema.Boolean,
  done: Schema.Array(Schema.String),
});
type GuideState = typeof GuideState.Type;

const readFlag = (key: string) => {
  try {
    return getLocalStorageItem(key, Schema.Boolean) === true;
  } catch {
    return false;
  }
};

// Whoever saw one of the three earlier first-run tips starts with the guide hidden. An account
// answers only for the tips it saw itself, never for the ones this browser showed someone else.
const sawEarlierTips = (owner: string | null) =>
  (owner === null
    ? [
        "t3code.roomBoardHintDismissed",
        "t3code:board-first-run:v1:browser",
        "t3code:board-coach:v1:browser",
      ]
    : [`t3code:board-first-run:v1:${owner}`, `t3code:board-coach:v1:${owner}`]
  ).some(readFlag);

const narrowScreen = () =>
  typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches;

/** The guide as it starts for someone this browser has kept nothing of: folded on a phone. */
export const initialBoardGuideState = (owner: string | null = null): GuideState => ({
  owner,
  hidden: sawEarlierTips(owner),
  collapsed: narrowScreen(),
  done: [],
});

/**
 * Makes the guide the person's who is signed in now (null: nobody), on every sign-in, switch and
 * sign-out, so nobody sees a step ticked that someone else did here.
 */
export function keepBoardGuideFor(signedIn: string | null): void {
  let kept: GuideState | null = null;
  try {
    removeLocalStorageItem(LEGACY_GUIDE_KEY);
    kept = getLocalStorageItem(GUIDE_KEY, GuideState);
  } catch {
    // Unreadable is kept nothing: the guide starts again.
  }
  const next = boardGuideAfterSignIn(kept, signedIn, initialBoardGuideState(signedIn));
  if (next !== kept) writeLocalStorageValue(GUIDE_KEY, next, next, GuideState);
}

/** A phone has no room for the open guide beside the board it points at. */
export const boardGuideFoldsAfterStep = narrowScreen;

const write = (update: (state: GuideState) => GuideState) =>
  writeLocalStorageValue(GUIDE_KEY, update, initialBoardGuideState(), GuideState);

/** Ticks a step for good, once the person has really done it. */
export function markBoardGuideStep(step: BoardGuideStepId): void {
  const initial = initialBoardGuideState();
  const state = readLocalStorageValue(GUIDE_KEY, initial, GuideState);
  if (state.done.includes(step)) return;
  writeLocalStorageValue(GUIDE_KEY, { ...state, done: [...state.done, step] }, initial, GuideState);
}

/** Brings the guide back, open, from wherever it was hidden or folded. */
export const showBoardGuide = () =>
  write((state) => ({ ...state, hidden: false, collapsed: false }));

export const hideBoardGuide = () => write((state) => ({ ...state, hidden: true }));

export const collapseBoardGuide = (collapsed: boolean) =>
  write((state) => ({ ...state, collapsed }));

/** The guide's state in this browser, shared by the card and the menu that brings it back. */
export const useBoardGuideState = (initial: GuideState): GuideState =>
  useLocalStorage(GUIDE_KEY, initial, GuideState)[0];
