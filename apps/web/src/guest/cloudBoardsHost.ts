import { guestHostZoneOf, isGuestHostAllowed } from "@t3tools/shared/guestLinks";
import { ownDomainHosts } from "@t3tools/shared/ownDomains";

import { configuredHostedAppUrl } from "../hostedPairing";

/**
 * The zone this page's cloud board host is in. `VITE_GUEST_HOST_ZONE` names it; without it, it
 * is the hosted app's own host minus its first label, on whichever of our domains the page is.
 */
const guestHostZone = (): string | null =>
  import.meta.env.VITE_GUEST_HOST_ZONE?.trim() || guestHostZoneOf(configuredHostedAppUrl());

/** The zones tunnels may be in: that zone on each of our domains, as links from either name them. */
export const guestHostZones = (): ReadonlyArray<string> => {
  const zone = guestHostZone();
  return zone === null ? [] : ownDomainHosts(zone);
};

/**
 * Where the cloud board host is: the configured origin (`http://localhost:8799` works for local
 * testing), else `boards.` in the deployment's zone, else nowhere.
 */
export function cloudBoardsOriginOf(input: {
  readonly configured: string | undefined;
  readonly zone: string | null;
}): string | null {
  const configured = input.configured?.trim() ?? "";
  if (configured !== "") return URL.canParse(configured) ? new URL(configured).origin : null;
  return input.zone === null || input.zone === "" ? null : `https://boards.${input.zone}`;
}

/** The cloud board host's origin, or null when this build has none. */
export const cloudBoardsOrigin = (): string | null =>
  cloudBoardsOriginOf({
    configured: import.meta.env.VITE_CLOUD_BOARDS_URL,
    zone: guestHostZone(),
  });

/** The cloud board host's `host`, as a guest link and a joined share name it. */
export const cloudBoardsHost = (): string | null => {
  const origin = cloudBoardsOrigin();
  return origin === null ? null : new URL(origin).host;
};

/** The cloud board host on each of our domains, this page's first. One service holds every board. */
export const cloudBoardsHosts = (): ReadonlyArray<string> => {
  const host = cloudBoardsHost();
  return host === null ? [] : ownDomainHosts(host);
};

export const isCloudBoardsHost = (host: string) => cloudBoardsHosts().includes(host);

/**
 * The host a guest link names, or null when the link may not be followed: no `host` is the page's
 * own; otherwise one of this deployment's tunnels, or the cloud board host under either of our
 * names, kept as this page's (`cloudHosts[0]`) so a browser holds each board once.
 */
export function acceptedGuestLinkHost(input: {
  readonly requested: string | null;
  readonly pageHost: string;
  readonly zones: ReadonlyArray<string>;
  readonly cloudHosts: ReadonlyArray<string>;
}): string | null {
  const { requested } = input;
  if (requested === null || requested === input.pageHost) return input.pageHost;
  if (input.cloudHosts.includes(requested)) return input.cloudHosts[0] ?? requested;
  return input.zones.some((zone) => isGuestHostAllowed(requested, zone)) ? requested : null;
}

/** The origin a share's guest routes are on, given where this page and the cloud host are. */
export function guestShareOriginOf(input: {
  readonly host: string;
  readonly page: { readonly host: string; readonly origin: string };
  readonly cloudOrigin: string | null;
}): string {
  if (input.host === input.page.host) return input.page.origin;
  // A board joined under the other name of the board host is on the same service.
  if (
    input.cloudOrigin !== null &&
    ownDomainHosts(new URL(input.cloudOrigin).host).includes(input.host)
  ) {
    return input.cloudOrigin;
  }
  return `https://${input.host}`;
}
