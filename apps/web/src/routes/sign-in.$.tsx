import { createFileRoute, redirect } from "@tanstack/react-router";

import { hasCloudPublicConfig } from "../cloud/publicConfig";
import { SignInPage } from "../components/clerk/SignInPage";
import { isElectron } from "../env";

// Every step of signing in and making an account lives under /sign-in/, on Clerk's page router.
export const Route = createFileRoute("/sign-in/$")({
  beforeLoad: () => {
    const clerkConfigured = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
    if (!clerkConfigured || !hasCloudPublicConfig() || isElectron) {
      throw redirect({ to: "/", replace: true });
    }
  },
  component: SignInPage,
});
