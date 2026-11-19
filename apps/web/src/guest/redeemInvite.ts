import { GUEST_ROUTE_PREFIX, GuestRedeemResult } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { SIGN_IN_UNCONFIRMED, boardJoinAuth, refreshAccountBoards } from "./boardAccount";
import { isCloudBoardsHost } from "./cloudBoardsHost";
import { guestShareOrigin, type JoinedGuestShare } from "./guestShares";
import { decodeRefusalBody, linkRefusalMessage } from "./linkRefusal.logic";

const decodeRedeemResult = Schema.decodeUnknownOption(GuestRedeemResult);

/**
 * Joins a share on the owner's host. Resolves to what the browser keeps of it, or to a message
 * for the person joining. A thread shared to a team also needs the member's assertion.
 */
export async function redeemInvite(input: {
  readonly credential: string;
  readonly host: string;
  readonly name: string;
  readonly memberAssertion?: string;
}): Promise<JoinedGuestShare | string> {
  const origin = guestShareOrigin(input.host);
  const cloud = isCloudBoardsHost(input.host);
  try {
    // Only the cloud board host sees the account: someone else's machine never gets its token.
    const account = cloud ? await boardJoinAuth() : null;
    if (account === "unconfirmed") return SIGN_IN_UNCONFIRMED;
    const response = await fetch(`${origin}${GUEST_ROUTE_PREFIX}/redeem`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(account === null ? {} : { authorization: account.authorization }),
      },
      body: JSON.stringify({
        credential: input.credential,
        // An account joins under its own name, whatever a field offered before it was known.
        name: account?.name ?? input.name,
        returnToken: true,
        ...(input.memberAssertion === undefined ? {} : { memberAssertion: input.memberAssertion }),
      }),
      // The host's own page also gets the share's cookie; any other origin keeps only the token.
      credentials: origin === window.location.origin ? "same-origin" : "omit",
    });
    const json: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      return Option.match(decodeRefusalBody(json), {
        onNone: () => "Something went wrong. Try again.",
        onSome: linkRefusalMessage,
      });
    }
    const result = Option.getOrNull(decodeRedeemResult(json));
    // A server from before guests could join from the app answers with a cookie only.
    if (result === null || result.threadId === undefined) {
      return "The owner's Tinkjam is too old for this link. Ask them to update it and send a new one.";
    }
    if (account !== null) void refreshAccountBoards();
    return {
      host: input.host,
      shareId: result.shareId,
      threadId: result.threadId,
      token: result.token,
      // A stand-in until the stream names it: a cloud board is never called a thread.
      title: result.title?.trim() || (cloud ? "Shared board" : "Shared thread"),
      joinedAt: new Date().toISOString(),
      // Anyone on a cloud board can invite others with the link they came in on.
      ...(cloud ? { credential: input.credential } : {}),
      ...(account === null ? {} : { accountId: account.userId }),
    };
  } catch {
    return "Could not reach the server.";
  }
}
