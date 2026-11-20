import { ClerkFailed, ClerkLoading, SignIn } from "@clerk/react";
import { useNavigate } from "@tanstack/react-router";
import { XIcon } from "lucide-react";
import { useState } from "react";

import { cloudBoardsOrigin } from "~/guest/cloudBoardsHost";
import { PRIVACY_POLICY_URL } from "~/legalLinks";

import { ArtCard, BrandArtPanel } from "../brand/BrandArtPanel";
import { Copyright, SplitScreen, splitLinkClassName } from "../brand/SplitScreen";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { signInScreenAppearance } from "./clerkAppearance";
import { readSignInPageRequest } from "./signInPageRequest";

/**
 * Signing in and making an account, every step of it (codes, a forgotten password, the return
 * from Google or Apple) on one page: the form in the person's theme, the cobalt art beside it.
 * Clerk shows whichever ways in its dashboard turns on. It goes back to where it was opened.
 */
export function SignInPage() {
  const [request] = useState(readSignInPageRequest);
  const navigate = useNavigate();
  const leave = (href: string) => void navigate({ href, replace: true });
  return (
    <SplitScreen
      corner={
        <Button variant="ghost" size="icon" aria-label="Close" onClick={() => leave(request.from)}>
          <XIcon />
        </Button>
      }
      footer={
        <>
          <Copyright />
          <a
            href={PRIVACY_POLICY_URL}
            target="_blank"
            rel="noreferrer"
            className="rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            Privacy and terms
          </a>
        </>
      }
      art={
        <BrandArtPanel headline={{ kind: "build" }}>
          <SignInArtCards />
        </BrandArtPanel>
      }
    >
      <ClerkLoading>
        <div role="status" aria-label="Loading sign-in" className="flex flex-col gap-4">
          <Skeleton className="h-11 w-40" />
          <Skeleton shape="pill" className="h-13 w-full" />
          <Skeleton shape="pill" className="h-13 w-full" />
          <Skeleton shape="card" className="h-12 w-full" />
        </div>
      </ClerkLoading>
      <ClerkFailed>
        <p role="alert" className="text-base text-foreground">
          Sign-in could not load. Check your internet connection, then reload this page.
        </p>
      </ClerkFailed>
      <div data-sign-in-form>
        <SignIn
          routing="path"
          path="/sign-in"
          appearance={signInScreenAppearance}
          withSignUp={request.withSignUp}
          {...(request.forceRedirectUrl ? { forceRedirectUrl: request.forceRedirectUrl } : {})}
          {...(request.signUpForceRedirectUrl
            ? { signUpForceRedirectUrl: request.signUpForceRedirectUrl }
            : {})}
        />
      </div>
      {cloudBoardsOrigin() !== null ? (
        <p className="mt-10 border-t border-border pt-5.5 text-ui-md text-muted-foreground">
          Just want to try it?{" "}
          <button type="button" className={splitLinkClassName} onClick={() => leave("/")}>
            Start a board without an account
          </button>
        </p>
      ) : null}
    </SplitScreen>
  );
}

/** The frame's illustration: a teammate's note, a board card and a cursor. Not product state. */
export function SignInArtCards() {
  return (
    <>
      <ArtCard className="bottom-37.5 left-13 w-53.5 -rotate-4 bg-brand-sun-tint p-4 text-ui-md font-medium">
        Bigger photos on the landing page, and lose the carousel.
        <div className="mt-3 text-xs font-semibold text-brand-ink/75">Priya</div>
      </ArtCard>
      <ArtCard className="right-12 bottom-16 w-82.5 rotate-2">
        <div className="flex items-center gap-2 border-b border-brand-panel px-3 py-2.5 font-semibold">
          Landing page
          <span className="ms-auto rounded-full bg-brand-forest px-2 py-0.75 text-2xs font-semibold text-white">
            Live
          </span>
        </div>
        <div className="p-3.5">
          <div className="h-30 rounded-lg bg-linear-135 from-brand-cobalt to-brand-sky" />
          <div className="mt-3.5 font-brand text-xl font-semibold tracking-tight">
            Spring collection
          </div>
          <div className="mt-2.5 flex gap-2">
            <span className="h-12 flex-1 rounded-md bg-brand-panel" />
            <span className="h-12 flex-1 rounded-md bg-brand-sun-tint" />
            <span className="h-12 flex-1 rounded-md bg-brand-tint" />
          </div>
        </div>
      </ArtCard>
      <div className="absolute bottom-44 left-71.5 flex items-start gap-0.5">
        <svg width="22" height="22" viewBox="0 0 18 18" aria-hidden>
          <path
            d="M2 2l5.5 13 2-5.5 5.5-2z"
            className="fill-brand-sun stroke-brand-ink"
            strokeWidth="1"
          />
        </svg>
        <span className="mt-3.5 rounded-full bg-brand-sun px-2.5 py-0.75 text-xs font-semibold text-brand-ink">
          Sam
        </span>
      </div>
    </>
  );
}
