import type {
  GuestId,
  GuestShareView,
  GuestThreadModel,
  OrchestrationV2AppThread,
  ServerProvider,
} from "@t3tools/contracts";

/** The thread's model as the owner's composer labels it, from the configured providers. */
export function guestThreadModel(
  selection: OrchestrationV2AppThread["modelSelection"],
  providers: ReadonlyArray<Pick<ServerProvider, "instanceId" | "driver" | "models">>,
): GuestThreadModel {
  const provider = providers.find((candidate) => candidate.instanceId === selection.instanceId);
  const model = provider?.models.find((candidate) => candidate.slug === selection.model);
  return {
    driver: provider?.driver ?? null,
    name: model?.name ?? selection.model,
    ...(model?.shortName === undefined ? {} : { shortName: model.shortName }),
    ...(model?.subProvider === undefined ? {} : { subProvider: model.subProvider }),
  };
}

/**
 * The share as one of its guests sees it, or null if that guest has not joined. No id means the
 * one guest of a link made before several could join.
 */
export function guestShareView(
  thread: OrchestrationV2AppThread,
  model: GuestThreadModel,
  guestId: GuestId | undefined,
  /** The thread's provider lets a trusted guest's message through; see `sendsDirectly`. */
  providerAllowsDirect: boolean,
): GuestShareView | null {
  const share = thread.guestShare;
  if (!share) return null;
  const guests = share.guests ?? [];
  const guest = guests.find((candidate) => candidate.id === guestId);
  const guestName =
    guestId === undefined
      ? share.guests === undefined
        ? share.guestName
        : null
      : (guest?.name ?? null);
  if (guestName === null) return null;
  return {
    shareId: share.id,
    title: thread.title,
    guestName,
    ...(guestId === undefined ? {} : { guestId }),
    guests,
    direct: providerAllowsDirect && guest?.trusted === true,
    expiresAt: share.expiresAt,
    messages: share.messages,
    model,
  };
}
