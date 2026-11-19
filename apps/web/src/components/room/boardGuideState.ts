import * as Schema from "effect/Schema";

import { readBoardAccountProfile } from "~/guest/boardAccount";
import {
  getLocalStorageItem,
  readLocalStorageValue,
  useLocalStorage,
  writeLocalStorageValue,
} from "~/hooks/useLocalStorage";

import type { BoardGuideStepId } from "./boardGuide.logic";

// Per browser: the first-run guide's steps done, and whether it is hidden or folded to its pill.
const GUIDE_KEY = "t3code:board-guide:v1";
const GuideState = Schema.Struct({
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

// Whoever saw one of the three earlier first-run tips starts with the guide hidden.
const sawEarlierTips = () => {
  const accountId = readBoardAccountProfile()?.userId ?? null;
  return [
    "t3code.roomBoardHintDismissed",
    ...["t3code:board-first-run:v1", "t3code:board-coach:v1"].flatMap((key) => [
      `${key}:browser`,
      ...(accountId === null ? [] : [`${key}:${accountId}`]),
    ]),
  ].some(readFlag);
};

const narrowScreen = () =>
  typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches;

/** The guide as it starts in a browser that has kept nothing of it: folded on a phone. */
export const initialBoardGuideState = (): GuideState => ({
  hidden: sawEarlierTips(),
  collapsed: narrowScreen(),
  done: [],
});

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
