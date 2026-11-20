import { CLOUD_BOARD_TITLE_MAX_LENGTH, GUEST_NAME_MAX_LENGTH } from "@t3tools/contracts";
import { CheckIcon } from "lucide-react";
import { useLocation } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useId, useState } from "react";

import { boardAccountsEnabled, useBoardAccount } from "~/guest/boardAccount";
import { knownBoardName, rememberBoardName, suggestedBoardName } from "~/guest/cloudBoards";
import { cloudBoardsOrigin } from "~/guest/cloudBoardsHost";
import { clearWelcomeDraft, keepWelcomeDraft, readWelcomeDraft } from "~/guest/welcomeDraft";
import type { WelcomeDraft } from "~/guest/welcomeDraft.logic";
import { cn } from "~/lib/utils";
import { sampleBoardHref } from "~/sampleBoard";

import { useT3ConnectAuthPrompt } from "../clerk/useT3ConnectAuthPrompt";
import { BoardBackdrop } from "../room/BoardChrome";
import { TinkjamWordmark } from "../TinkjamLogo";
import { Button, InlineButton } from "../ui/button";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import { AccountCorner } from "./BoardsAccount";
import { BoardThumbnail } from "./BoardThumbnail";
import { type BoardTemplate, STARTER_BOARD_TEMPLATES, boardTemplateShapes } from "./boardTemplates";
import { UNTITLED_BOARD } from "./boardsHome.logic";
import { useFirstRunFocusOffered } from "./homeFocus";
import { useNewBoardWaiting, useStartNewBoard } from "./newBoard";
import { CreateWorkspaceButton } from "./Workspaces";

const STARTER_IDS = STARTER_BOARD_TEMPLATES.map((choice) => choice.id);

/**
 * The home before a person has any board: what Tinkjam is, and one button that starts a board,
 * blank or from a starter, under a name they can keep. Signing in is offered, never required, and
 * nothing here moves or empties when they do: the form is kept across it.
 */
export function BoardsWelcome() {
  const account = useBoardAccount();
  const cloud = cloudBoardsOrigin() !== null;
  const sample = cloud ? sampleBoardHref() : null;
  const alone = useFirstRunFocusOffered();
  return (
    <BoardBackdrop
      className="relative flex min-h-full flex-1 flex-col px-4 pt-20 pb-8 motion-safe:animate-page-fade sm:pt-16 sm:pb-10"
      data-boards-welcome
    >
      {/* Alone on the page, the welcome carries the name the sidebar otherwise shows. */}
      {alone ? (
        <TinkjamWordmark
          className="absolute start-4 top-5 inline-flex items-center gap-2 sm:start-7 sm:top-6"
          markClassName="size-6 shrink-0"
          wordClassName="text-wordmark-sm"
        />
      ) : null}
      <AccountCorner />
      {/* Top-anchored on a phone, so the line under the card can change without moving the card. */}
      <div className="mx-auto mb-auto flex w-full max-w-[26.25rem] flex-col motion-safe:animate-page-rise sm:my-auto">
        <StartBoardForm
          className="flex w-full flex-col gap-5 rounded-dialog border border-rule bg-raised p-6 text-card-foreground shadow-modal sm:p-8"
          heading={
            <h1 className="font-heading text-heading-sm font-semibold tracking-heading text-balance text-foreground">
              Your team and your agents, on one board
            </h1>
          }
        >
          {sample === null && !boardAccountsEnabled() ? null : (
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-rule pt-4">
              {sample === null ? (
                <span />
              ) : (
                <InlineButton tone="accent" render={<a href={sample} />} data-welcome-sample-board>
                  Look around a sample board
                </InlineButton>
              )}
              {boardAccountsEnabled() ? (
                account.status === "signed-out" ? (
                  <WelcomeSignIn />
                ) : account.status === "signed-in" ? (
                  <CreateWorkspaceButton />
                ) : null
              ) : null}
            </div>
          )}
        </StartBoardForm>
      </div>
    </BoardBackdrop>
  );
}

/**
 * Starting a board, blank or from a starter, under a name the person can keep. What is typed is
 * kept for the tab, so signing in or changing page never empties it.
 */
export function StartBoardForm({
  className,
  heading,
  children,
}: {
  readonly className: string;
  /** Between the starters and the fields. */
  readonly heading?: ReactNode;
  readonly children?: ReactNode;
}) {
  const account = useBoardAccount();
  const startNewBoard = useStartNewBoard();
  const waiting = useNewBoardWaiting();
  const cloud = cloudBoardsOrigin() !== null;
  const helpId = useId();
  const [draft, setDraft] = useState(() => readWelcomeDraft(STARTER_IDS));
  // A name is asked for here, once, only of someone who has none. Its place then stays put.
  const [asked] = useState(() => cloud && knownBoardName() === null);
  const [suggested] = useState(suggestedBoardName);
  const [submitted, setSubmitted] = useState(false);
  const [starting, setStarting] = useState(false);
  // The board is made and its page is loading: the button keeps saying so until it takes over.
  const leaving = useLocation({ select: (location) => location.pathname !== "/" });
  const busy = starting || waiting || leaving;
  const template =
    STARTER_BOARD_TEMPLATES.find((choice) => choice.id === draft.templateId) ??
    STARTER_BOARD_TEMPLATES[0]!;
  const describe = (choice: BoardTemplate) =>
    cloud ? (choice.cloudDescription ?? choice.description) : choice.description;
  const accountName = account.status === "signed-in" ? account.name : null;
  // Signing in from here with an account that has a name: it shows where the field was.
  const named = asked && accountName !== null && !submitted;
  const typing = asked && !named;
  const name = draft.name ?? suggested;
  const needsName = typing && name.trim() === "";
  const change = (patch: Partial<WelcomeDraft>) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    keepWelcomeDraft(next);
  };
  const start = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || needsName) return;
    if (typing) {
      setSubmitted(true);
      rememberBoardName(name);
    }
    setStarting(true);
    await startNewBoard(template, undefined, draft.title.trim() || null);
    clearWelcomeDraft();
    setStarting(false);
  };
  return (
    <form className={className} onSubmit={start}>
      <fieldset className="flex min-w-0 flex-col">
        <legend className="sr-only">Start with</legend>
        <ul className="grid grid-cols-3 gap-2" data-welcome-templates>
          {STARTER_BOARD_TEMPLATES.map((choice) => {
            const selected = choice.id === template.id;
            return (
              <li key={choice.id}>
                <button
                  type="button"
                  aria-pressed={selected}
                  className={cn(
                    "relative flex h-full w-full cursor-pointer flex-col overflow-hidden rounded-xl border bg-raised text-start outline-none transition-[border-color,box-shadow] duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                    selected
                      ? "border-primary ring-1 ring-primary"
                      : "border-rule hover:border-quiet/60",
                  )}
                  data-welcome-template={choice.id}
                  onClick={() => change({ templateId: choice.id })}
                >
                  <span className="border-b border-rule">
                    <BoardThumbnail shapes={boardTemplateShapes(choice, cloud)} ratio="tile" />
                  </span>
                  {selected ? (
                    <span
                      aria-hidden
                      className="absolute end-1.5 top-1.5 grid size-4.5 place-items-center rounded-full bg-primary text-primary-foreground"
                    >
                      <CheckIcon className="size-3" />
                    </span>
                  ) : null}
                  <span className="truncate px-2 py-1.5 text-xs font-semibold text-foreground">
                    {choice.name}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-xs text-quiet">{describe(template)}</p>
      </fieldset>
      {heading}
      <div className="flex flex-col gap-3.5">
        {typing ? (
          <label className="flex min-w-0 flex-col gap-1.5 text-ui-sm font-semibold text-foreground">
            Your name
            <Input
              size="lg"
              autoComplete="name"
              maxLength={GUEST_NAME_MAX_LENGTH}
              value={name}
              aria-invalid={needsName || undefined}
              aria-describedby={needsName ? helpId : undefined}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => change({ name: event.currentTarget.value })}
              data-welcome-name
            />
          </label>
        ) : null}
        {named ? (
          <div className="flex min-w-0 flex-col gap-1.5 text-ui-sm font-semibold text-foreground">
            Your name
            <span
              className="flex h-10 items-center truncate text-sm font-normal sm:h-9"
              data-welcome-account-name
            >
              {accountName}
            </span>
          </div>
        ) : null}
        <label className="flex min-w-0 flex-col gap-1.5 text-ui-sm font-semibold text-foreground">
          Board name
          <Input
            size="lg"
            maxLength={CLOUD_BOARD_TITLE_MAX_LENGTH}
            placeholder={UNTITLED_BOARD}
            value={draft.title}
            onChange={(event) => change({ title: event.currentTarget.value })}
            data-welcome-title
          />
        </label>
        {needsName ? (
          <p id={helpId} className="text-xs text-danger" role="alert">
            Add your name to start a board.
          </p>
        ) : null}
      </div>
      <div>
        <Button
          type="submit"
          size="pill"
          disabled={busy || needsName}
          aria-busy={busy || undefined}
          data-welcome-start
        >
          {busy ? <Spinner aria-hidden /> : null}
          Start a board
        </Button>
      </div>
      {children}
    </form>
  );
}

/** The way to an account; optional, and the boards made before it stay. */
function WelcomeSignIn() {
  const { openAuthPrompt } = useT3ConnectAuthPrompt();
  return (
    <InlineButton tone="accent" onClick={openAuthPrompt} data-welcome-sign-in>
      Sign in
    </InlineButton>
  );
}
