import { describe, expect, it } from "vite-plus/test";

import { resolveClerkSignInProps } from "./authRedirect";

describe("resolveClerkSignInProps", () => {
  it("removes a Clerk virtual pathname and callback params while preserving the desktop route", () => {
    expect(
      resolveClerkSignInProps(
        "t3code://app/CLERK-ROUTER/VIRTUAL/sign-up?__clerk_status=complete#/settings/connections",
        true,
      ),
    ).toEqual({
      forceRedirectUrl: "t3code://app/#/settings/connections",
      signUpForceRedirectUrl: "t3code://app/#/settings/connections",
    });
  });

  it("comes back to a page with a fragment as a new page load, so the new session shows", () => {
    expect(resolveClerkSignInProps("https://app.example.org/join-workspace#code", false)).toEqual({
      forceRedirectUrl: "https://app.example.org/join-workspace?signed-in=1#code",
      signUpForceRedirectUrl: "https://app.example.org/join-workspace?signed-in=1#code",
    });
    expect(resolveClerkSignInProps("https://app.example.org/", false).forceRedirectUrl).toBe(
      "https://app.example.org/",
    );
  });
});
