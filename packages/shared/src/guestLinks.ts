const GUEST_LINK_PATH = "/guest";

/**
 * The link an owner hands a guest. With a hosted app it opens there and names the owner's host;
 * without one it opens on the owner's host itself. The credential rides in the fragment either
 * way, so it never reaches a server log.
 */
export function buildGuestLink(input: {
  readonly host: string;
  readonly credential: string;
  readonly hostedAppUrl: string | null;
}): string {
  if (input.hostedAppUrl === null) {
    return `https://${input.host}${GUEST_LINK_PATH}#${input.credential}`;
  }
  const url = new URL(GUEST_LINK_PATH, input.hostedAppUrl);
  url.searchParams.set("host", input.host);
  url.hash = input.credential;
  return url.toString();
}

const SHORT_GUEST_LINK_PATH = "/r";

/** The readable form of a guest link: the hosted app asks the relay what the name stands for. */
export function buildShortGuestLink(input: {
  readonly name: string;
  readonly hostedAppUrl: string;
}): string {
  return new URL(`${SHORT_GUEST_LINK_PATH}/${input.name}`, input.hostedAppUrl).toString();
}

const HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * The zone a hosted app's tunnels live in when none is configured: the app's own host without
 * its first label (`app.example.org` serves guests of `<name>.example.org`).
 */
export function guestHostZoneOf(hostedAppUrl: string): string | null {
  if (!URL.canParse(hostedAppUrl)) return null;
  const labels = new URL(hostedAppUrl).hostname.split(".");
  return labels.length < 3 ? null : labels.slice(1).join(".");
}

/**
 * Whether a link's `host` is one of this deployment's tunnels: one label directly under the
 * zone, nothing else. The host comes from a link anyone can write, and the page sends it a
 * guest's name and keeps a token for it, so anything outside the zone is refused.
 */
export function isGuestHostAllowed(host: string, zone: string | null): boolean {
  if (zone === null || zone === "") return false;
  const suffix = `.${zone.toLowerCase()}`;
  if (host !== host.toLowerCase() || !host.endsWith(suffix)) return false;
  return HOST_LABEL.test(host.slice(0, -suffix.length));
}
