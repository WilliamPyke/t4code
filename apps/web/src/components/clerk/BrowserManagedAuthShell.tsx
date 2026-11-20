import { ClerkProvider } from "@clerk/react";
import type { ComponentProps, ReactNode } from "react";

import { ManagedRelayAuthProvider } from "../../cloud/managedAuth";
import { staysInApp } from "./authRedirect";
import { BoardAccountBridge } from "./BoardAccountBridge";
import { clerkAppearance, clerkLocalization } from "./clerkAppearance";

type ClerkRouterFn = NonNullable<ComponentProps<typeof ClerkProvider>["routerPush"]>;

/** Lazy-load Clerk so cloudless local mode never downloads it. */
export default function BrowserManagedAuthShell({
  publishableKey,
  navigate,
  children,
}: {
  readonly publishableKey: string;
  /** Moves to a page of this app without loading it again. */
  readonly navigate: (to: string, replace: boolean) => Promise<void>;
  readonly children: ReactNode;
}) {
  // Without these Clerk loads the page again after every sign-in and sign-out, which blanks the
  // screen and empties whatever form the person was in.
  const move =
    (replace: boolean): ClerkRouterFn =>
    (to, metadata) =>
      staysInApp(to, window.location.origin)
        ? navigate(to, replace)
        : (metadata?.windowNavigate ?? window.location.assign.bind(window.location))(to);
  return (
    <ClerkProvider
      appearance={clerkAppearance}
      localization={clerkLocalization}
      publishableKey={publishableKey}
      signInUrl="/sign-in"
      signUpUrl="/sign-in"
      routerPush={move(false)}
      routerReplace={move(true)}
    >
      <ManagedRelayAuthProvider>{children}</ManagedRelayAuthProvider>
      <BoardAccountBridge />
    </ClerkProvider>
  );
}
