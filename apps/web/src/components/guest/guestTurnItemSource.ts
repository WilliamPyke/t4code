import {
  type GuestShareEndpoint,
  guestShareEvents,
  guestShareRequest,
} from "@t3tools/client-runtime/rpc";
import {
  applyCommandOutputFrame,
  EMPTY_COMMAND_OUTPUT,
} from "@t3tools/client-runtime/state/command-output";
import {
  GUEST_COMMAND_OUTPUT_ROUTE,
  GUEST_ITEM_ROUTE,
  OrchestrationV2CommandOutputFrame,
  OrchestrationV2GetTurnItemResult,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { Atom } from "effect/reactivity";

import type { TurnItemSource } from "../chat/timelineRowContext";

/** What an expanded row of a shared thread says when it cannot read the item. */
class GuestItemReadError extends Schema.TaggedError<GuestItemReadError>()("GuestItemReadError", {
  message: Schema.String,
}) {}

const decodeDetail = Schema.decodeUnknownSync(Schema.toCodecJson(OrchestrationV2GetTurnItemResult));
const decodeFrame = Schema.decodeUnknownOption(
  Schema.fromJsonString(OrchestrationV2CommandOutputFrame),
);

/** `item` is null when the thread no longer has the item, or the share ended. */
async function fetchGuestItemDetail(
  endpoint: GuestShareEndpoint,
  itemId: string,
): Promise<OrchestrationV2GetTurnItemResult> {
  const response = await guestShareRequest(endpoint, GUEST_ITEM_ROUTE, {
    params: { item: itemId },
  });
  if (response.status === 403) return { item: null };
  if (!response.ok) throw new Error(`Guest item request failed with ${response.status}.`);
  return decodeDetail(await response.json());
}

/**
 * Expanded rows of a shared thread read through the share's guest routes. The atoms are keyed
 * by item, and belong to one view of one share, so they end with it.
 */
export function guestTurnItemSource(endpoint: GuestShareEndpoint): TurnItemSource {
  const detail = Atom.family((key: string) => {
    const [itemId] = JSON.parse(key) as [string, string];
    return Atom.make(
      Effect.tryPromise({
        try: () => fetchGuestItemDetail(endpoint, itemId),
        catch: () => new GuestItemReadError({ message: "Could not load this item." }),
      }),
    );
  });
  // `scan` emits its seed first; skipping it keeps the row "loading" until the first frame.
  const commandOutput = Atom.family((itemId: string) =>
    Atom.make(
      guestShareEvents(endpoint, GUEST_COMMAND_OUTPUT_ROUTE, { item: itemId }).pipe(
        Stream.map((data) => Option.getOrNull(decodeFrame(data))),
        Stream.filter((frame) => frame !== null),
        // The frame of a settled command is the last one worth reading.
        Stream.takeUntil((frame) => !frame.running),
        Stream.mapError(
          () => new GuestItemReadError({ message: "Output is no longer available." }),
        ),
        Stream.scan(() => EMPTY_COMMAND_OUTPUT, applyCommandOutputFrame),
        Stream.filter((view) => view !== EMPTY_COMMAND_OUTPUT),
      ),
    ),
  );
  return {
    detail: ({ itemId, revision }) => detail(JSON.stringify([itemId, revision])),
    commandOutput: ({ itemId }) => commandOutput(itemId),
  };
}
