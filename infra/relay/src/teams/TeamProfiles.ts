import { createClerkClient } from "@clerk/backend";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

import * as RelayConfiguration from "../Config.ts";
import { ClerkUserLookupFailed } from "../t3chat/T3ChatAccounts.ts";
import type { TeamProfile } from "./Teams.ts";

const LOOKUP_TIMEOUT = "5 seconds";

/** The name and picture a signed-in user's account shows, as teammates see them. */
export class TeamProfiles extends Context.Service<
  TeamProfiles,
  {
    /** None when the account could not be read; callers keep what they stored before. */
    readonly lookup: (userId: string) => Effect.Effect<Option.Option<TeamProfile>>;
  }
>()("t3code-relay/teams/TeamProfiles") {}

export const layer = Layer.effect(
  TeamProfiles,
  Effect.gen(function* () {
    const config = yield* RelayConfiguration.RelayConfiguration;
    const lookup = Effect.fn("relay.teams.lookup_profile")(
      function* (userId: string) {
        const user = yield* Effect.tryPromise({
          try: () =>
            createClerkClient({
              secretKey: Redacted.value(config.clerkSecretKey),
              publishableKey: config.clerkPublishableKey,
            }).users.getUser(userId),
          catch: (cause) => new ClerkUserLookupFailed({ cause }),
        });
        const name =
          user.fullName?.trim() ||
          user.username?.trim() ||
          user.primaryEmailAddress?.emailAddress.split("@")[0] ||
          "T Code user";
        return Option.some<TeamProfile>({ name, avatarUrl: user.hasImage ? user.imageUrl : null });
      },
      Effect.timeout(LOOKUP_TIMEOUT),
      Effect.catchCause((cause) =>
        Effect.logWarning("Could not read a team member's profile", { cause }).pipe(
          Effect.as(Option.none<TeamProfile>()),
        ),
      ),
    );
    return TeamProfiles.of({ lookup });
  }),
);
