import { CLOUD_BOARD_TITLE_MAX_LENGTH, GUEST_NAME_MAX_LENGTH } from "@t3tools/contracts";
import { CheckIcon } from "lucide-react";
import { useLocation } from "@tanstack/react-router";
import { type FormEvent, useId, useState } from "react";

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
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import { AccountCorner } from "./BoardsAccount";
import { BoardThumbnail } from "./BoardThumbnail";
import { type BoardTemplate, STARTER_BOARD_TEMPLATES, boardTemplateShapes } from "./boardTemplates";
import { UNTITLED_BOARD } from "./boardsHome.logic";
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
  const startNewBoard = useStartNewBoard();
  const waiting = useNewBoardWaiting();
  const cloud = cloudBoardsOrigin() !== null;
  const sample = cloud ? sampleBoardHref() : null;
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
    <BoardBackdrop
      className="relative flex min-h-full flex-1 flex-col px-4 pt-12 pb-8 motion-safe:animate-page-fade sm:pt-16 sm:pb-10"
      data-boards-welcome
    >
      <AccountCorner />
      {/* Top-anchored on a phone, so the line under the card can change without moving the card. */}
      <div className="mx-auto mb-auto flex w-full max-w-2xl flex-col gap-4 motion-safe:animate-page-rise sm:my-auto">
        <form
          className="flex w-full flex-col gap-5 rounded-board border border-board-hairline bg-card p-5 text-card-foreground shadow-board sm:gap-7 sm:p-8"
          onSubmit={start}
        >
          <div className="flex flex-col gap-3">
            <TinkjamWordmark wordClassName="h-5 w-auto shrink-0" markClassName="size-7 shrink-0" />
            <div className="flex flex-col gap-1.5">
              <h1 className="text-xl leading-tight font-semibold tracking-tight text-balance sm:text-2xl">
                Your team and your agents, on one board
              </h1>
              <p className="text-sm text-pretty text-muted-foreground">
                Notes, links and tasks in one place, with your team and your agents working on them
                together. Nothing to install.
              </p>
            </div>
          </div>
          <fieldset className="flex min-w-0 flex-col">
            <legend className="mb-2 text-sm font-medium">Start with</legend>
            <ul className="grid grid-cols-3 gap-2 sm:gap-3" data-welcome-templates>
              {STARTER_BOARD_TEMPLATES.map((choice) => {
                const selected = choice.id === template.id;
                return (
                  <li key={choice.id}>
                    <button
                      type="button"
                      aria-pressed={selected}
                      className={cn(
                        "relative flex h-full w-full cursor-pointer flex-col overflow-hidden rounded-board border bg-card text-start outline-none transition-[border-color,box-shadow] duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                        selected
                          ? "border-primary shadow-board ring-1 ring-primary"
                          : "border-board-hairline shadow-paint hover:border-foreground/25",
                      )}
                      data-welcome-template={choice.id}
                      onClick={() => change({ templateId: choice.id })}
                    >
                      <span className="border-b border-board-hairline">
                        <BoardThumbnail shapes={boardTemplateShapes(choice, cloud)} />
                      </span>
                      {selected ? (
                        <span
                          aria-hidden
                          className="absolute end-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-primary text-primary-foreground"
                        >
                          <CheckIcon className="size-3" />
                        </span>
                      ) : null}
                      <span className="flex flex-col gap-0.5 px-2 py-1.5 sm:p-2.5">
                        <span className="text-xs leading-tight font-semibold sm:text-sm">
                          {choice.name}
                        </span>
                        <span className="hidden text-xs text-muted-foreground sm:block">
                          {describe(choice)}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            {/* On a phone the cards are too narrow for their descriptions: the chosen one's is here. */}
            <p className="mt-2 min-h-8 text-xs text-muted-foreground sm:hidden">
              {describe(template)}
            </p>
          </fieldset>
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-3">
              {typing ? (
                <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
                  Your name
                  <Input
                    size="lg"
                    autoComplete="name"
                    maxLength={GUEST_NAME_MAX_LENGTH}
                    value={name}
                    aria-describedby={helpId}
                    onFocus={(event) => event.currentTarget.select()}
                    onChange={(event) => change({ name: event.currentTarget.value })}
                    data-welcome-name
                  />
                </label>
              ) : null}
              {named ? (
                <div className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
                  Your name
                  <span
                    className="flex h-10 items-center truncate font-normal sm:h-9"
                    data-welcome-account-name
                  >
                    {accountName}
                  </span>
                </div>
              ) : null}
              <label
                className={cn(
                  "flex min-w-0 flex-col gap-1.5 text-sm font-medium",
                  asked ? null : "col-span-2",
                )}
              >
                Board name
                <Input
                  size="lg"
                  maxLength={CLOUD_BOARD_TITLE_MAX_LENGTH}
                  placeholder={UNTITLED_BOARD}
                  value={draft.title}
                  aria-describedby={helpId}
                  onChange={(event) => change({ title: event.currentTarget.value })}
                  data-welcome-title
                />
              </label>
            </div>
            <p id={helpId} className="text-xs text-pretty text-muted-foreground">
              {needsName ? "Add your name to start a board. " : ""}
              {typing
                ? "People you invite see your name. Naming the board is optional, and you can rename it later."
                : "Naming the board is optional, and you can rename it later."}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
            <Button
              type="submit"
              size="lg"
              disabled={busy || needsName}
              aria-busy={busy || undefined}
              data-welcome-start
            >
              {busy ? <Spinner aria-hidden /> : null}
              Start a board
            </Button>
            {sample === null ? null : (
              <Button
                variant="outline"
                size="lg"
                render={<a href={sample} />}
                data-welcome-sample-board
              >
                Look around a sample board
              </Button>
            )}
          </div>
        </form>
        {/* Outside the form: a dialog's own form would otherwise submit this one too. Its height is
            kept whoever is signed in, so the card above never moves. */}
        {boardAccountsEnabled() ? (
          <div className="flex min-h-9 flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-sm text-muted-foreground">
            {account.status === "signed-out" ? (
              <WelcomeSignIn />
            ) : account.status === "signed-in" ? (
              <>
                Working with a team?
                <CreateWorkspaceButton />
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </BoardBackdrop>
  );
}

/** The way to an account, said for someone who has none yet: optional, and why it is worth it. */
function WelcomeSignIn() {
  const { openAuthPrompt } = useT3ConnectAuthPrompt();
  return (
    <p className="flex flex-wrap items-center justify-center">
      <Button type="button" variant="link" size="sm" onClick={openAuthPrompt} data-welcome-sign-in>
        Sign in or create an account
      </Button>
      so your boards follow you to every device.
    </p>
  );
}
