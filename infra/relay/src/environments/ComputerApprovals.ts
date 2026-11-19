import { and, eq, gt, isNull, lt, or } from "drizzle-orm";
import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import * as RelayDb from "../db.ts";
import { relayComputerApprovals } from "../persistence/schema.ts";

/** Long enough to finish signing in on Clerk's page after pressing Connect. */
const COMPUTER_APPROVAL_LIFETIME_MINUTES = 30;

export class ComputerApprovalPersistenceError extends Schema.TaggedError<ComputerApprovalPersistenceError>()(
  "ComputerApprovalPersistenceError",
  {
    operation: Schema.Literals(["create", "redeem", "finish"]),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to ${this.operation} a computer approval`;
  }
}

/**
 * What a person's press of Connect leaves on the relay. Only the computer holding the verifier of
 * that sign-in can redeem it, for one key, and only until the link it carried is saved.
 */
export class ComputerApprovals extends Context.Service<
  ComputerApprovals,
  {
    readonly create: (input: {
      readonly userId: string;
      readonly codeChallenge: string;
    }) => Effect.Effect<{ readonly expiresAt: string }, ComputerApprovalPersistenceError>;
    /** The approval's code challenge when it is unused, unexpired and not held by another key. */
    readonly redeem: (input: {
      readonly userId: string;
      readonly verifier: string;
      readonly environmentPublicKey: string;
    }) => Effect.Effect<string | null, ComputerApprovalPersistenceError>;
    readonly finish: (input: {
      readonly userId: string;
      readonly codeChallenge: string;
    }) => Effect.Effect<void, ComputerApprovalPersistenceError>;
  }
>()("t3code-relay/environments/ComputerApprovals") {}

const make = Effect.gen(function* () {
  const db = yield* RelayDb.RelayDb;
  const digest = yield* Digest.Digest;
  const table = relayComputerApprovals;

  return ComputerApprovals.of({
    create: Effect.fn("relay.computer_approvals.create")(
      function* (input) {
        const now = yield* DateTime.now;
        const createdAt = DateTime.formatIso(now);
        const expiresAt = DateTime.formatIso(
          DateTime.add(now, { minutes: COMPUTER_APPROVAL_LIFETIME_MINUTES }),
        );
        yield* db
          .delete(table)
          .where(and(eq(table.userId, input.userId), lt(table.expiresAt, createdAt)));
        // Connect pressed again for the same sign-in renews it, unless it was already spent.
        yield* db
          .insert(table)
          .values({ ...input, expiresAt, createdAt })
          .onConflictDoUpdate({
            target: [table.userId, table.codeChallenge],
            set: { expiresAt, createdAt },
            setWhere: isNull(table.usedAt),
          });
        return { expiresAt };
      },
      Effect.mapError(
        (cause) => new ComputerApprovalPersistenceError({ operation: "create", cause }),
      ),
    ),

    redeem: Effect.fn("relay.computer_approvals.redeem")(
      function* (input) {
        const codeChallenge = Base64Url.encode(
          yield* digest.digest(Digest.sha256, new TextEncoder().encode(input.verifier)),
        );
        const now = DateTime.formatIso(yield* DateTime.now);
        const rows = yield* db
          .update(table)
          .set({ environmentPublicKey: input.environmentPublicKey })
          .where(
            and(
              eq(table.userId, input.userId),
              eq(table.codeChallenge, codeChallenge),
              gt(table.expiresAt, now),
              isNull(table.usedAt),
              or(
                isNull(table.environmentPublicKey),
                eq(table.environmentPublicKey, input.environmentPublicKey),
              ),
            ),
          )
          .returning({ codeChallenge: table.codeChallenge });
        return rows.length > 0 ? codeChallenge : null;
      },
      Effect.mapError(
        (cause) => new ComputerApprovalPersistenceError({ operation: "redeem", cause }),
      ),
    ),

    finish: Effect.fn("relay.computer_approvals.finish")(
      function* (input) {
        const usedAt = DateTime.formatIso(yield* DateTime.now);
        yield* db
          .update(table)
          .set({ usedAt })
          .where(
            and(
              eq(table.userId, input.userId),
              eq(table.codeChallenge, input.codeChallenge),
              isNull(table.usedAt),
            ),
          );
      },
      Effect.mapError(
        (cause) => new ComputerApprovalPersistenceError({ operation: "finish", cause }),
      ),
    ),
  });
});

export const layer = Layer.effect(ComputerApprovals, make);
