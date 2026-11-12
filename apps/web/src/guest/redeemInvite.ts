import { GUEST_ROUTE_PREFIX, GuestRedeemResult } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { guestShareOrigin, type JoinedGuestShare } from "./guestShares";

const decodeErrorBody = Schema.decodeUnknownOption(Schema.Struct({ message: Schema.String }));
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
  try {
    const response = await fetch(`${origin}${GUEST_ROUTE_PREFIX}/redeem`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        credential: input.credential,
        name: input.name,
        returnToken: true,
        ...(input.memberAssertion === undefined ? {} : { memberAssertion: input.memberAssertion }),
      }),
      // The host's own page also gets the share's cookie; any other origin keeps only the token.
      credentials: origin === window.location.origin ? "same-origin" : "omit",
    });
    const json: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      return Option.match(decodeErrorBody(json), {
        onNone: () => "Something went wrong. Try again.",
        onSome: ({ message }) => message,
      });
    }
    const result = Option.getOrNull(decodeRedeemResult(json));
    // A server from before guests could join from the app answers with a cookie only.
    if (result === null || result.threadId === undefined) {
      return "The owner's T Code is too old for this link. Ask them to update it and send a new one.";
    }
    return {
      host: input.host,
      shareId: result.shareId,
      threadId: result.threadId,
      token: result.token,
      title: "Shared thread",
      joinedAt: new Date().toISOString(),
    };
  } catch {
    return "Could not reach the server.";
  }
}
