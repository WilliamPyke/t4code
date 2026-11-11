import { RELAY_GUEST_LINK_NAME_PATTERN, type RelayGuestLinkTarget } from "@t3tools/contracts/relay";
import { and, eq, gt, lt } from "drizzle-orm";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as RelayDb from "../db.ts";
import { relayGuestLinks } from "../persistence/schema.ts";
import { GUEST_LINK_WORDS } from "./words.ts";

export const GUEST_LINK_RESOLVE_RATE_LIMIT = { limit: 10, periodSeconds: 60 } as const;

const NAME_ATTEMPTS = 5;

export class GuestLinkPersistenceError extends Schema.TaggedError<GuestLinkPersistenceError>()(
  "GuestLinkPersistenceError",
  {
    operation: Schema.Literals(["register", "resolve"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to ${this.operation} a guest link name`;
  }
}

const isPersistenceError = Schema.is(GuestLinkPersistenceError);

/** Per caller address: the name is short enough to guess, so guesses are counted. */
export class GuestLinkRateLimiter extends Context.Service<
  GuestLinkRateLimiter,
  { readonly allow: (key: string) => Effect.Effect<boolean> }
>()("t3code-relay/guestLinks/GuestLinks/GuestLinkRateLimiter") {}

export class GuestLinks extends Context.Service<
  GuestLinks,
  {
    /** The same link registered again keeps its name. */
    readonly register: (input: {
      readonly environmentId: string;
      readonly host: string;
      readonly credential: string;
      readonly expiresAt: string;
    }) => Effect.Effect<string, GuestLinkPersistenceError>;
    readonly resolve: (
      name: string,
    ) => Effect.Effect<RelayGuestLinkTarget | null, GuestLinkPersistenceError>;
  }
>()("t3code-relay/guestLinks/GuestLinks") {}

/** Rejection sampling over two bytes, so no word or digit is likelier than another. */
const pick = (random: SecureRandom.SecureRandom["Service"], size: number): Effect.Effect<number> =>
  random.randomBytes(2).pipe(
    Effect.map(([high = 0, low = 0]) => high * 256 + low),
    Effect.flatMap((value) =>
      value < 65_536 - (65_536 % size) ? Effect.succeed(value % size) : pick(random, size),
    ),
  );

const make = Effect.gen(function* () {
  const db = yield* RelayDb.RelayDb;
  const random = yield* SecureRandom.SecureRandom;

  const word = Effect.map(
    pick(random, GUEST_LINK_WORDS.length),
    (index) => GUEST_LINK_WORDS[index],
  );
  const makeName = Effect.map(Effect.all([word, word, word]), (words) => words.join("-"));

  const register: GuestLinks["Service"]["register"] = Effect.fn("relay.guest_links.register")(
    function* (input) {
      const now = DateTime.formatIso(yield* DateTime.now);
      yield* db.delete(relayGuestLinks).where(lt(relayGuestLinks.expiresAt, now));
      for (let attempt = 0; attempt < NAME_ATTEMPTS; attempt++) {
        // A taken name inserts nothing and the loop tries another; a known credential keeps its row.
        yield* db
          .insert(relayGuestLinks)
          .values({ ...input, name: yield* makeName, createdAt: now })
          .onConflictDoNothing();
        const [row] = yield* db
          .select({ name: relayGuestLinks.name })
          .from(relayGuestLinks)
          .where(
            and(
              eq(relayGuestLinks.credential, input.credential),
              eq(relayGuestLinks.environmentId, input.environmentId),
            ),
          )
          .limit(1);
        if (row) return row.name;
      }
      return yield* new GuestLinkPersistenceError({
        operation: "register",
        cause: "no free guest link name",
      });
    },
    Effect.mapError((cause) =>
      isPersistenceError(cause)
        ? cause
        : new GuestLinkPersistenceError({ operation: "register", cause }),
    ),
  );

  const resolve: GuestLinks["Service"]["resolve"] = Effect.fn("relay.guest_links.resolve")(
    function* (name) {
      if (!RELAY_GUEST_LINK_NAME_PATTERN.test(name)) return null;
      const now = DateTime.formatIso(yield* DateTime.now);
      const [row] = yield* db
        .select({ host: relayGuestLinks.host, credential: relayGuestLinks.credential })
        .from(relayGuestLinks)
        .where(and(eq(relayGuestLinks.name, name), gt(relayGuestLinks.expiresAt, now)))
        .limit(1);
      return row ?? null;
    },
    Effect.mapError((cause) => new GuestLinkPersistenceError({ operation: "resolve", cause })),
  );

  return GuestLinks.of({ register, resolve });
});

export const layer = Layer.effect(GuestLinks, make);
