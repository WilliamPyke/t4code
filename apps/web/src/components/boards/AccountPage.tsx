import { useAtomValue } from "@effect/atom-react";
import { useClerk, useUser } from "@clerk/react";
import { GUEST_NAME_MAX_LENGTH } from "@t3tools/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeftIcon, LogInIcon, LogOutIcon, ShieldCheckIcon } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";

import { boardAccountsEnabled, saveBoardAccountName, useBoardAccount } from "~/guest/boardAccount";
import { accountBoardsAtom } from "~/guest/guestShares";

import { useT3ConnectAuthPrompt } from "../clerk/useT3ConnectAuthPrompt";
import { Button } from "../ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Input } from "../ui/input";
import { SidebarInset } from "../ui/sidebar";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";

/**
 * A person's own account page, apart from the developer settings: their name and picture, signing
 * out, and what happens to the boards they made.
 */
export function AccountPage() {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-y-auto overscroll-y-none" data-account-page>
      {boardAccountsEnabled() ? (
        <ConfiguredAccountPage />
      ) : (
        <Notice
          title="This copy of Tinkjam has no accounts"
          detail="Your boards are kept in this browser and on your computer."
        />
      )}
    </SidebarInset>
  );
}

function Notice({
  title,
  detail,
  children,
}: {
  readonly title: string;
  readonly detail: string;
  readonly children?: ReactNode;
}) {
  return (
    <Empty className="flex-1">
      <EmptyHeader className="max-w-md">
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{detail}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        {children}
        <Button variant="outline" render={<Link to="/" />}>
          Go to your boards
        </Button>
      </EmptyContent>
    </Empty>
  );
}

function ConfiguredAccountPage() {
  const account = useBoardAccount();
  const { user } = useUser();
  const { openAuthPrompt } = useT3ConnectAuthPrompt();
  if (account.status === "signed-out") {
    return (
      <Notice title="You are not signed in" detail="Sign in to keep your boards on every device.">
        <Button onClick={openAuthPrompt}>
          <LogInIcon />
          Sign in
        </Button>
      </Notice>
    );
  }
  if (account.status !== "signed-in" || user == null) {
    return (
      <Empty className="flex-1">
        <Spinner aria-label="Loading your account" />
      </Empty>
    );
  }
  return <SignedInAccount name={account.name} />;
}

function SignedInAccount({ name }: { readonly name: string | null }) {
  const { user } = useUser();
  const clerk = useClerk();
  const navigate = useNavigate();
  const boards = useAtomValue(accountBoardsAtom);
  if (user == null) return null;
  const made = boards?.filter((board) => board.maker).length ?? null;
  const joined = boards === null ? null : boards.length - (made ?? 0);
  const email = user.primaryEmailAddress?.emailAddress ?? null;
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6">
      <div>
        <Button variant="ghost-muted" size="sm" render={<Link to="/" />}>
          <ArrowLeftIcon />
          Boards
        </Button>
      </div>
      <header className="flex items-center gap-4">
        <img
          src={user.imageUrl}
          alt=""
          className="size-16 shrink-0 rounded-full border border-board-hairline bg-muted object-cover"
        />
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="text-2xl leading-tight font-semibold wrap-anywhere">
            {name ?? "Your account"}
          </h1>
          {email === null ? null : (
            <p className="text-sm text-muted-foreground wrap-anywhere">Signed in as {email}</p>
          )}
        </div>
      </header>

      <Section title="Your name" detail="Everyone on your boards sees it.">
        <NameForm initial={name ?? ""} />
        <p className="text-xs text-muted-foreground">
          Boards you are already on keep the name you joined them with.
        </p>
      </Section>

      <Section
        title="Picture, email and password"
        detail="Your picture shows beside your name on your boards and in your workspaces."
      >
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => clerk.openUserProfile()}>
            <ShieldCheckIcon />
            Manage sign-in and picture
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              void clerk.signOut().then(() => navigate({ to: "/", replace: true }));
            }}
            data-account-sign-out
          >
            <LogOutIcon />
            Sign out
          </Button>
        </div>
      </Section>

      <Section title="Your boards">
        <p className="text-sm">
          {made === null || joined === null
            ? "Counting your boards…"
            : `You made ${made} ${made === 1 ? "board" : "boards"} and joined ${joined}.`}
        </p>
        <p className="text-sm text-muted-foreground">
          Boards you made stay for everyone on them until you delete them. Signing out keeps them;
          sign in again on any device to get back to them.
        </p>
        <p className="text-sm text-muted-foreground">
          Deleting all your Tinkjam data in one step is not here yet. Until it is, delete each board
          you made from its menu on the home (it goes for everyone on it), and leave the boards
          others made (your cards there stay, with your name).
        </p>
      </Section>
    </div>
  );
}

function Section({
  title,
  detail,
  children,
}: {
  readonly title: string;
  readonly detail?: string;
  readonly children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-board border border-board-hairline bg-card p-4 text-card-foreground shadow-paint sm:p-5">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-base font-semibold">{title}</h2>
        {detail === undefined ? null : <p className="text-sm text-muted-foreground">{detail}</p>}
      </div>
      {children}
    </section>
  );
}

function NameForm({ initial }: { readonly initial: string }) {
  const [typed, setTyped] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const name = typed ?? initial;
  const changed = typed !== null && typed.trim() !== initial;
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === "" || saving || !changed) return;
    setSaving(true);
    const saved = (await saveBoardAccountName(trimmed)) ?? false;
    setSaving(false);
    setTyped(null);
    toastManager.add(
      saved
        ? { type: "success", title: "Name saved" }
        : {
            type: "info",
            title: "Saved on this browser",
            description: "Your account could not keep the name, so other devices may ask again.",
          },
    );
  };
  return (
    <form className="flex flex-wrap items-center gap-2" onSubmit={save}>
      <div className="w-full sm:w-72">
        <Input
          aria-label="Your name"
          autoComplete="name"
          maxLength={GUEST_NAME_MAX_LENGTH}
          placeholder="Your name"
          value={name}
          onChange={(event) => setTyped(event.currentTarget.value)}
          data-account-name
        />
      </div>
      <Button type="submit" disabled={saving || !changed || name.trim() === ""}>
        {saving ? <Spinner aria-hidden /> : null}
        Save
      </Button>
    </form>
  );
}
