import { CLOUD_BOARD_ACCOUNT_CLAIM_MAX, GUEST_NAME_MAX_LENGTH } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  accountDisplayName,
  accountNameParts,
  boardsToClaim,
  friendlyName,
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
  it("offers its own cloud boards the account does not list, each once", () => {
    const shares = [
      share("made-here"),
      share("listed"),
      share("on-a-machine", { host: "tunnel.example.org" }),
      share("opened-by-account", { accountId: "user_ada" }),
      share("refused-before"),
    ];
    expect(
      boardsToClaim({
        shares,
        listed: [{ shareId: "listed" }],
        tried: new Set(["refused-before"]),
        isCloud,
      }).map((candidate) => candidate.shareId),
    ).toEqual(["made-here"]);
  });

  it("offers at most one claim's worth at a time", () => {
    const shares = Array.from({ length: CLOUD_BOARD_ACCOUNT_CLAIM_MAX + 3 }, (_, index) =>
      share(`share-${index}`),
    );
    expect(boardsToClaim({ shares, listed: [], tried: new Set(), isCloud })).toHaveLength(
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
    [
      "the full name",
      { fullName: "  Ada   Lovelace ", firstName: "Ada" },
      null,
      "Ada Lovelace",
      true,
    ],
    [
      "first and last name over this browser's",
      { fullName: "", firstName: "Ada", lastName: "King" },
      "Countess",
      "Ada King",
      true,
    ],
    ["the first name alone", { firstName: "Ada", lastName: null }, null, "Ada", true],
    ["this browser's name over the username", { username: "ada_k" }, " Ada  K ", "Ada K", false],
    ["the username", { firstName: " ", username: "ada_k" }, null, "ada_k", false],
    // The email is not even read: a sign-up with only an email has no name until they give one.
    ["nothing from an email-only account", {}, null, null, false],
    [
      "a name cut to fit",
      { fullName: `${"A".repeat(GUEST_NAME_MAX_LENGTH)} B` },
      null,
      "A".repeat(GUEST_NAME_MAX_LENGTH),
      true,
    ],
  ] as const)("takes %s", (_case, profile, browserName, name, real) => {
    expect(accountDisplayName(profile, browserName)).toEqual({ name, real });
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
