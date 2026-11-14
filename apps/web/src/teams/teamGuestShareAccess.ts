import { GuestShareAccess } from "@t3tools/client-runtime/rpc";
import { EnvironmentId } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  findGuestShare,
  forgetGuestShare,
  type JoinedGuestShare,
  layerGuestShareAccess,
} from "../guest/guestShares";
import { joinTeamThread } from "./teams";
import { teamSessionDue } from "./teamSession.logic";

/** Joins the share's team thread again as the member; false when the team no longer lets them. */
const rejoin = Effect.fn("TeamGuestShareAccess.rejoin")(function* (share: JoinedGuestShare) {
  const { team } = share;
  if (team === undefined) return false;
  const joined = yield* Effect.promise(() =>
    joinTeamThread(team.id, {
      environmentId: EnvironmentId.make(team.environmentId),
      host: share.host,
      credential: team.credential,
      title: share.title,
    }),
  );
  if (!joined.ok) return false;
  // The owner shared it again since, so this entry now names a share that is gone.
  if (joined.value.shareId !== share.shareId) forgetGuestShare(share.shareId);
  return joined.value.shareId === share.shareId;
});

/**
 * A member's session on a team thread lasts a day. Opening it later joins again with a fresh
 * member assertion, and a refused session does the same before the thread is let go.
 */
export const layerTeamGuestShareAccess = Layer.effect(
  GuestShareAccess,
  Effect.gen(function* () {
    const base = yield* GuestShareAccess;
    return GuestShareAccess.of({
      ...base,
      share: Effect.fn("TeamGuestShareAccess.share")(function* (shareId: string) {
        const stored = findGuestShare(shareId);
        if (stored !== null && teamSessionDue(stored, yield* Clock.currentTimeMillis)) {
          yield* rejoin(stored);
        }
        return yield* base.share(shareId);
      }),
      ended: Effect.fn("TeamGuestShareAccess.ended")(function* (shareId: string) {
        const stored = findGuestShare(shareId);
        if (stored?.team !== undefined && (yield* rejoin(stored))) return;
        yield* base.ended(shareId);
      }),
    });
  }),
).pipe(Layer.provide(layerGuestShareAccess));
