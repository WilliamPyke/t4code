import { CLOUD_BOARD_TITLE_MAX_LENGTH, GUEST_NAME_MAX_LENGTH } from "@t3tools/contracts";
import { type FormEvent, useState } from "react";

import { boardAccountsEnabled, useBoardAccount } from "~/guest/boardAccount";
import { knownBoardName, rememberBoardName, suggestedBoardName } from "~/guest/cloudBoards";
import { cloudBoardsOrigin } from "~/guest/cloudBoardsHost";
import { cn } from "~/lib/utils";
import { sampleBoardHref } from "~/sampleBoard";

import { useT3ConnectAuthPrompt } from "../clerk/useT3ConnectAuthPrompt";
import { BoardBackdrop } from "../room/BoardChrome";
import { TinkjamWordmark } from "../TinkjamLogo";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Spinner } from "../ui/spinner";
import { AccountCorner, AccountNameAsk } from "./BoardsAccount";
import { BoardThumbnail } from "./BoardThumbnail";
import { type BoardTemplate, STARTER_BOARD_TEMPLATES, boardTemplateShapes } from "./boardTemplates";
import { UNTITLED_BOARD } from "./boardsHome.logic";
import { useNewBoardWaiting, useStartNewBoard } from "./newBoard";
import { CreateWorkspaceButton } from "./Workspaces";

/**
 * The home before a person has any board: what Tinkjam is, and one button that starts a board,
 * blank or from a starter, under a name they can keep. Signing in is offered, never required.
 */
export function BoardsWelcome() {
  const account = useBoardAccount();
  const startNewBoard = useStartNewBoard();
  const waiting = useNewBoardWaiting();
  const cloud = cloudBoardsOrigin() !== null;
  const sample = cloud ? sampleBoardHref() : null;
  // Asked once, here and nowhere else: a signed-in account brings its own name.
  const [askName] = useState(() => cloud && knownBoardName() === null);
  const [name, setName] = useState(suggestedBoardName);
  const [title, setTitle] = useState("");
  const [template, setTemplate] = useState<BoardTemplate>(STARTER_BOARD_TEMPLATES[0]!);
  const [starting, setStarting] = useState(false);
  const busy = starting || waiting;
  // An account with no name of its own (signed up with only an email) is asked too.
  const needsName = askName && (account.status !== "signed-in" || account.name === null);
  const start = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || (needsName && name.trim() === "")) return;
    if (needsName) rememberBoardName(name);
    setStarting(true);
    await startNewBoard(template, undefined, title.trim() || null);
    setStarting(false);
  };
  return (
    <BoardBackdrop className="relative flex min-h-full flex-1 px-4 pt-16 pb-10" data-boards-welcome>
      <AccountCorner />
      <div className="m-auto flex w-full max-w-2xl flex-col gap-3">
        <AccountNameAsk />
        <form
          className="flex w-full flex-col gap-6 rounded-board border border-board-hairline bg-card p-6 text-card-foreground shadow-board sm:p-8"
          onSubmit={start}
        >
          <div className="flex flex-col gap-3">
            <TinkjamWordmark wordClassName="h-5 w-auto shrink-0" markClassName="size-8 shrink-0" />
            <h1 className="text-2xl leading-tight font-semibold tracking-tight">
              Your team and your agents, on one board
            </h1>
            <p className="text-sm text-muted-foreground">
              Put notes, links and tasks on a board, invite your team, and bring in your agents to
              help. Nothing to install.
            </p>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-sm font-medium">Start with</legend>
            <ul className="grid grid-cols-1 gap-3 sm:grid-cols-3" data-welcome-templates>
              {STARTER_BOARD_TEMPLATES.map((choice) => (
                <li key={choice.id}>
                  <button
                    type="button"
                    aria-pressed={choice.id === template.id}
                    className={cn(
                      "flex h-full w-full flex-col overflow-hidden rounded-board border bg-card text-start shadow-paint outline-none transition-shadow hover:shadow-board focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                      choice.id === template.id
                        ? "border-primary ring-2 ring-primary/30"
                        : "border-board-hairline",
                    )}
                    data-welcome-template={choice.id}
                    onClick={() => setTemplate(choice)}
                  >
                    <span className="border-b border-board-hairline">
                      <BoardThumbnail shapes={boardTemplateShapes(choice, cloud)} />
                    </span>
                    <span className="flex flex-col gap-0.5 p-2.5">
                      <span className="text-sm font-semibold">{choice.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {cloud
                          ? (choice.cloudDescription ?? choice.description)
                          : choice.description}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </fieldset>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {needsName ? (
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Your name
                <Input
                  autoComplete="name"
                  maxLength={GUEST_NAME_MAX_LENGTH}
                  value={name}
                  onFocus={(event) => event.currentTarget.select()}
                  onChange={(event) => setName(event.currentTarget.value)}
                  data-welcome-name
                />
                <span className="text-xs font-normal text-muted-foreground">
                  Everyone you invite sees it.
                </span>
              </label>
            ) : null}
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Board name
              <Input
                maxLength={CLOUD_BOARD_TITLE_MAX_LENGTH}
                placeholder={UNTITLED_BOARD}
                value={title}
                onChange={(event) => setTitle(event.currentTarget.value)}
                data-welcome-title
              />
              <span className="text-xs font-normal text-muted-foreground">
                Optional. You can rename it later.
              </span>
            </label>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="submit"
              size="lg"
              disabled={busy || (needsName && name.trim() === "")}
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
            {account.status === "signed-out" && boardAccountsEnabled() ? <WelcomeSignIn /> : null}
          </div>
        </form>
        {/* Outside the form: the dialog's own form would otherwise submit this one too. */}
        {account.status === "signed-in" ? (
          <div className="flex flex-wrap items-center justify-center gap-2 text-sm text-muted-foreground">
            Working with a team?
            <CreateWorkspaceButton />
          </div>
        ) : null}
      </div>
    </BoardBackdrop>
  );
}

function WelcomeSignIn() {
  const { openAuthPrompt } = useT3ConnectAuthPrompt();
  return (
    <p className="flex items-center gap-1 text-sm text-muted-foreground">
      Have an account?
      <Button type="button" variant="link" size="sm" onClick={openAuthPrompt} data-welcome-sign-in>
        Sign in
      </Button>
    </p>
  );
}
