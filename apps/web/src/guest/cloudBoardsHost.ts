import { guestHostZoneOf, isGuestHostAllowed } from "@t3tools/shared/guestLinks";

import { configuredHostedAppUrl } from "../hostedPairing";

/**
 * The zone this deployment's tunnels live in. `VITE_GUEST_HOST_ZONE` names it; without it, it is
 * the hosted app's own host minus its first label.
 */
export const guestHostZone = (): string | null =>
  import.meta.env.VITE_GUEST_HOST_ZONE?.trim() || guestHostZoneOf(configuredHostedAppUrl());

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

export const isCloudBoardsHost = (host: string) => host === cloudBoardsHost();

/**
 * The host a guest link names, or null when the link may not be followed: no `host` is the page's
 * own; otherwise one of this deployment's tunnels, or its cloud board host.
 */
export function acceptedGuestLinkHost(input: {
  readonly requested: string | null;
  readonly pageHost: string;
  readonly zone: string | null;
  readonly cloudHost: string | null;
}): string | null {
  const { requested } = input;
  if (requested === null || requested === input.pageHost) return input.pageHost;
  if (requested === input.cloudHost) return requested;
  return isGuestHostAllowed(requested, input.zone) ? requested : null;
}

/** The origin a share's guest routes are on, given where this page and the cloud host are. */
export function guestShareOriginOf(input: {
  readonly host: string;
  readonly page: { readonly host: string; readonly origin: string };
  readonly cloudOrigin: string | null;
}): string {
  if (input.host === input.page.host) return input.page.origin;
  if (input.cloudOrigin !== null && new URL(input.cloudOrigin).host === input.host) {
    return input.cloudOrigin;
  }
  return `https://${input.host}`;
}
