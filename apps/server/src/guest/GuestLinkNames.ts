import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { readRelayConnection } from "../cloud/config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import { makeRelayEnvironmentClient } from "../relay/relayEnvironmentClient.ts";

/** Readable names for guest links, kept by the relay this server is linked to. */
export class GuestLinkNames extends Context.Service<
  GuestLinkNames,
  {
    /** Null when there is no relay to ask or it did not answer: the full link still works. */
    readonly register: (input: {
      readonly host: string;
      readonly credential: string;
      readonly expiresAt: string;
    }) => Effect.Effect<string | null>;
  }
>()("t3/guest/GuestLinkNames") {}

const make = Effect.gen(function* () {
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const environment = yield* ServerEnvironment.ServerEnvironment;

  const register: GuestLinkNames["Service"]["register"] = Effect.fn("GuestLinkNames.register")(
    function* (payload) {
      const connection = yield* readRelayConnection;
      if (connection === null) return null;
      const client = yield* makeRelayEnvironmentClient(connection);
      const { name } = yield* client.server.registerGuestLink({
        params: { environmentId: yield* environment.getEnvironmentId },
        payload,
      });
      return name;
    },
    Effect.provideService(ServerSecretStore.ServerSecretStore, secrets),
    Effect.timeout("5 seconds"),
    Effect.catchCause((cause) =>
      Effect.logWarning("Could not name a guest link", { cause }).pipe(Effect.as(null)),
    ),
  );

  return GuestLinkNames.of({ register });
});

export const layer = Layer.effect(GuestLinkNames, make);
