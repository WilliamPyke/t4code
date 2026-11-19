import { CLOUD_BOARD_ACCOUNT_CLAIM_MAX, GUEST_NAME_MAX_LENGTH } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  accountDisplayName,
  accountNameParts,
  accountNameSeed,
  boardsToClaim,
  browserAfterSignIn,
  friendlyName,
  resolveBoardName,
  sharedNameIds,
  sharesOfOtherAccounts,
} from "./boardAccount.logic";

const share = (shareId: string, extra: { host?: string; accountId?: string } = {}) => ({
  shareId,
  token: `${shareId}.secret`,
  host: extra.host ?? "boards.example.org",
  ...(extra.accountId === undefined ? {} : { accountId: extra.accountId }),
});
const isCloud = (candidate: { readonly host: string }) => candidate.host === "boards.example.org";

describe("boards a browser adds to the account", () => {
  it("offers its own cloud boards joined signed out, each once", () => {
    const shares = [
      share("made-here"),
      // Joined signed out on a board the account is on already: offered, so the two become one.
      share("account-is-on-it"),
      share("on-a-machine", { host: "tunnel.example.org" }),
      share("opened-by-account", { accountId: "user_ada" }),
      share("refused-before"),
    ];
    expect(
      boardsToClaim({ shares, tried: new Set(["refused-before"]), isCloud }).map(
        (candidate) => candidate.shareId,
      ),
    ).toEqual(["made-here", "account-is-on-it"]);
  });

  it("offers at most one claim's worth at a time", () => {
    const shares = Array.from({ length: CLOUD_BOARD_ACCOUNT_CLAIM_MAX + 3 }, (_, index) =>
      share(`share-${index}`),
    );
    expect(boardsToClaim({ shares, tried: new Set(), isCloud })).toHaveLength(
      CLOUD_BOARD_ACCOUNT_CLAIM_MAX,
    );
  });

  it("forgets only boards opened under an account that is no longer signed in", () => {
    const shares = [
      share("signed-out"),
      share("ada", { accountId: "user_ada" }),
      share("bo", { accountId: "user_bo" }),
    ];
    expect(sharesOfOtherAccounts(shares, "user_ada")).toEqual(["bo"]);
    expect(sharesOfOtherAccounts(shares, null)).toEqual(["ada", "bo"]);
  });
});

describe("the name a person joins a board under", () => {
  it.each([
    ["the full name", { fullName: "  Ada   Lovelace ", firstName: "Ada" }, "Ada Lovelace", true],
    [
      "first and last name over a saved one",
      { fullName: "", firstName: "Ada", lastName: "King", savedName: "Countess" },
      "Ada King",
      true,
    ],
    ["the first name alone", { firstName: "Ada", lastName: null }, "Ada", true],
    [
      "the name it saved over the username",
      { username: "ada_k", savedName: " Ada  K " },
      "Ada K",
      true,
    ],
    ["the username", { firstName: " ", username: "ada_k" }, "ada_k", false],
    // The email is not even read: a sign-up with only an email has no name until they give one.
    ["nothing from an email-only account", {}, null, false],
    [
      "a name cut to fit",
      { fullName: `${"A".repeat(GUEST_NAME_MAX_LENGTH)} B` },
      "A".repeat(GUEST_NAME_MAX_LENGTH),
      true,
    ],
  ] as const)("takes %s", (_case, profile, name, real) => {
    expect(accountDisplayName(profile)).toEqual({ name, real });
  });

  // A: an account that signed in here before; B: the one signing in now.
  it.each([
    ["seeds a name typed signed out on a browser nobody signed in on", null, [], "Bo", "Bo"],
    ["seeds it for the account that signed in here before", null, ["user_b"], "Bo", "Bo"],
    ["never seeds after another account signed in here", null, ["user_a"], "Bo", null],
    ["never seeds the last account's name on a switch", "user_a", ["user_a"], "QA One", null],
    ["has nothing to seed when nothing was typed", null, [], null, null],
  ] as const)("%s", (_case, current, accounts, name, seed) => {
    const { identity } = browserAfterSignIn({ name, accounts, current }, "user_b");
    expect(accountNameSeed(identity, "user_b")).toBe(seed);
  });

  // Every name field reads this, so a person is asked at most once and offered one suggestion.
  it.each([
    [
      "signed out with nothing typed: unknown, and the browser's one suggestion",
      { account: null, signedOutName: null },
      { known: null, suggested: "Calm Otter" },
    ],
    [
      "signed out after typing a name: known, never asked again",
      { account: null, signedOutName: " Bo " },
      { known: "Bo", suggested: "Bo" },
    ],
    [
      "signed in with a name: the account's, over whatever this browser kept",
      { account: { name: "Ada Lovelace", seed: "Bo" }, signedOutName: "Bo" },
      { known: "Ada Lovelace", suggested: "Ada Lovelace" },
    ],
    [
      "signed in with only an email: unknown, starting from what they typed signed out",
      { account: { name: null, seed: "Bo" }, signedOutName: "Bo" },
      { known: null, suggested: "Bo" },
    ],
    [
      "signed in with only an email on a browser someone else used: empty, never a made-up name",
      { account: { name: null, seed: null }, signedOutName: "QA One" },
      { known: null, suggested: "" },
    ],
  ] as const)("%s", (_case, input, resolved) => {
    expect(resolveBoardName({ ...input, suggestion: "Calm Otter" })).toEqual(resolved);
  });

  it("clears the last account's things on sign-out or a switch, and only then", () => {
    const signedOut = { name: "Bo", accounts: [], current: null };
    const signedIn = browserAfterSignIn(signedOut, "user_a");
    expect(signedIn).toEqual({
      identity: { name: "Bo", accounts: ["user_a"], current: "user_a" },
      clear: false,
    });
    expect(browserAfterSignIn(signedIn.identity, "user_a")).toEqual({
      identity: signedIn.identity,
      clear: false,
    });
    // Signing out takes the name typed before too: it was this account's from sign-in on.
    expect(browserAfterSignIn(signedIn.identity, null)).toEqual({
      identity: { name: null, accounts: ["user_a"], current: null },
      clear: true,
    });
    expect(browserAfterSignIn(signedIn.identity, "user_b")).toEqual({
      identity: { name: null, accounts: ["user_a", "user_b"], current: "user_b" },
      clear: true,
    });
  });

  it("tells apart only the people who share a name", () => {
    const people = [
      { id: "a", name: "QA One" },
      { id: "b", name: " qa one" },
      { id: "c", name: "Ada" },
    ];
    expect([...sharedNameIds(people)]).toEqual(["a", "b"]);
    expect(sharedNameIds([{ id: "c", name: "Ada" }]).size).toBe(0);
  });

  it("keeps a typed name on the account as first and last name", () => {
    expect(accountNameParts("  Mary  Ann Smith ")).toEqual({
      firstName: "Mary Ann",
      lastName: "Smith",
    });
    expect(accountNameParts("Ada")).toEqual({ firstName: "Ada", lastName: "" });
    expect(accountNameParts("   ")).toEqual({ firstName: "", lastName: "" });
  });

  it("suggests a friendly name that always fits", () => {
    expect(friendlyName(() => 0)).toBe("Bright Badger");
    for (let index = 0; index < 144; index += 1) {
      const name = friendlyName((count) => (index * 7) % count);
      expect(name.length).toBeLessThanOrEqual(GUEST_NAME_MAX_LENGTH);
      expect(name).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
    }
  });
});
