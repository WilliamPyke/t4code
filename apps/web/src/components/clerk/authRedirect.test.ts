import { describe, expect, it } from "vite-plus/test";

import { parseSignInPageRequest, resolveClerkSignInProps, staysInApp } from "./authRedirect";

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

describe("parseSignInPageRequest", () => {
  const origin = "https://app.example.org";
  it("keeps a request for this site", () => {
    expect(
      parseSignInPageRequest(
        JSON.stringify({
          from: "https://app.example.org/guest?share=abc",
          forceRedirectUrl: "https://app.example.org/guest?share=abc",
          withSignUp: false,
        }),
        origin,
      ),
    ).toEqual({
      from: "/guest?share=abc",
      forceRedirectUrl: "https://app.example.org/guest?share=abc",
      withSignUp: false,
    });
  });

  it.each([
    [
      "another site",
      JSON.stringify({
        from: "https://evil.example.com/",
        forceRedirectUrl: "https://evil.example.com/",
      }),
    ],
    [
      "a script address",
      JSON.stringify({ from: "javascript:alert(1)", forceRedirectUrl: "javascript:alert(1)" }),
    ],
    ["nothing kept", null],
    ["something that is not JSON", "{"],
  ] as const)("goes home, never elsewhere, from %s", (_case, raw) => {
    expect(parseSignInPageRequest(raw, origin)).toEqual({ from: "/", withSignUp: true });
  });
});

describe("staysInApp", () => {
  const origin = "https://app.example.org";
  it.each([
    ["the home, where signing in from the welcome and signing out both land", "/", true],
    ["the home with a query", "/?from=invite", true],
    // The invite pages hold their invite in memory, so signing in there needs no new document.
    ["a board's invite page", "/guest?host=boards.example.org&share=abc", true],
    ["a workspace's invite page, its code already out of the address", "/join-workspace", true],
    [
      "a workspace's invite page with its code, which a plain move would only scroll to",
      "/join-workspace?signed-in=1#code",
      false,
    ],
    // These read a session or a pairing as they load, so they keep their new document.
    ["a board", "/b/abc", false],
    ["a pairing page", "/pair?token=abc", false],
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
