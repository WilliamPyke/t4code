import { useState } from "react";

import { useBoardAccount } from "~/guest/boardAccount";
import { detectSyncOs } from "~/syncDownloads";

import { BrandArtPanel } from "../brand/BrandArtPanel";
import { SplitHeading, SplitScreen, splitLinkClassName } from "../brand/SplitScreen";
import { SignInArtCards } from "../clerk/SignInPage";
import { ConnectComputerFlow, StepEyebrow } from "../ConnectComputerDialog";
import { Button } from "../ui/button";
import { BoardsAccount } from "./BoardsAccount";
import { StartBoardForm } from "./BoardsWelcome";
import { useFirstRunFocusOffered } from "./homeFocus";

// Per browser: the computer step was finished or skipped, so a reload opens on the board step.
const STEP_KEY = "tinkjam:first-run-step:v1";

type Step = "computer" | "board";

const readStep = (): Step => {
  try {
    return window.localStorage.getItem(STEP_KEY) === "board" ? "board" : "computer";
  } catch {
    return "computer";
  }
};

/**
 * Whether the home before a first board is the first run's two steps: for someone signed in, on a
 * computer that can run Tinkjam Sync. Signed out, or on a phone, it is the one welcome card.
 */
export function useFirstRunSteps(): boolean {
  const account = useBoardAccount();
  const [onComputer] = useState(() => detectSyncOs() !== null);
  return useFirstRunFocusOffered() && account.status === "signed-in" && onComputer;
}

/** A new account's first minutes: connect the computer its agents are on, then start a board. */
export function FirstRun() {
  const [step, setStep] = useState(readStep);
  const go = (next: Step) => {
    setStep(next);
    try {
      window.localStorage.setItem(STEP_KEY, next);
    } catch {
      // Blocked storage only means a reload starts at the first step.
    }
  };
  const corner = <BoardsAccount />;
  if (step === "computer") {
    return (
      <div data-first-run="computer">
        <ConnectComputerFlow
          corner={corner}
          eyebrow="Step 1 of 2"
          countConnected
          onSkip={() => go("board")}
          done={
            <Button size="pill" onClick={() => go("board")}>
              Continue
            </Button>
          }
        />
      </div>
    );
  }
  return (
    <div data-first-run="board">
      <SplitScreen
        corner={corner}
        footer={
          <button type="button" className={splitLinkClassName} onClick={() => go("computer")}>
            Back
          </button>
        }
        art={
          <BrandArtPanel headline={{ kind: "build" }}>
            <SignInArtCards />
          </BrandArtPanel>
        }
      >
        <StepEyebrow>Step 2 of 2</StepEyebrow>
        <SplitHeading>Start your first board</SplitHeading>
        <StartBoardForm className="mt-7 flex w-full flex-col gap-5" />
      </SplitScreen>
    </div>
  );
}
