import { describe, expect, it } from "vite-plus/test";

import { resolveClerkSignInProps, staysInApp } from "./authRedirect";

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

describe("staysInApp", () => {
  const origin = "https://app.example.org";
  it.each([
    ["the home, where signing in from the welcome and signing out both land", "/", true],
    ["the home with a query", "/?from=invite", true],
    // These read an invite or a pairing as they load, so they keep their new document.
    ["a join page", "/guest?share=abc", false],
    [
      "the home with a fragment, which a plain move would only scroll to",
      "/?signed-in=1#code",
      false,
    ],
    ["another site", "https://accounts.example.org/", false],
    ["an address that does not parse", "http://[", false],
  ] as const)("%s", (_case, to, stays) => {
    expect(staysInApp(to, origin)).toBe(stays);
  });
});
