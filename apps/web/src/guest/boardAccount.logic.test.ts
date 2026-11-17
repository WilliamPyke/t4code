import { CLOUD_BOARD_ACCOUNT_CLAIM_MAX, GUEST_NAME_MAX_LENGTH } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  accountDisplayName,
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
    ["the full name", { fullName: "  Ada   Lovelace ", firstName: "Ada" }, "Ada Lovelace"],
    ["first and last name", { fullName: "", firstName: "Ada", lastName: "King" }, "Ada King"],
    ["the first name alone", { firstName: "Ada", lastName: null }, "Ada"],
    ["the username", { firstName: " ", username: "ada_k" }, "ada_k"],
    ["the email before the @", { email: "ada.king@example.org" }, "ada.king"],
    ["nothing", { email: "@example.org" }, null],
    [
      "a name cut to fit",
      { fullName: `${"A".repeat(GUEST_NAME_MAX_LENGTH)} B` },
      "A".repeat(GUEST_NAME_MAX_LENGTH),
    ],
  ] as const)("takes %s from a signed-in account", (_case, profile, expected) => {
    expect(accountDisplayName(profile)).toBe(expected);
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
