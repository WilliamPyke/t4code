import { DEFAULT_HOSTED_APP_URL } from "@t3tools/shared/connectAuth";
import { ownDomainOrigins } from "@t3tools/shared/ownDomains";

import { isLoopbackHost } from "@t3tools/shared/preview";
import { getPairingTokenFromUrl, setPairingTokenOnUrl } from "@t3tools/shared/remote";

export interface HostedPairingRequest {
  readonly host: string;
  readonly token: string;
  readonly label: string;
}

export type HostedAppChannel = "latest" | "nightly";

/**
 * The hosted app that links name and checks compare with. A page on the same app on another of
 * our domains is that app: what a person copies opens where their sign-in and joined boards live.
 */
export function configuredHostedAppUrl(): string {
  const configured = builtHostedAppUrl();
  const page =
    typeof window === "undefined" || window.location === undefined ? null : window.location.origin;
  return page !== null && builtHostedAppOrigins().includes(page) ? page : configured;
}

const builtHostedAppUrl = () =>
  import.meta.env.VITE_HOSTED_APP_URL?.trim() || DEFAULT_HOSTED_APP_URL;

/**
 * A link a computer made for the hosted app (a guest link, say), moved to the origin this page
 * is on when that is the same app on our other domain, so it opens where the sender's access is.
 */
export function onThisHostedApp(link: string): string {
  if (!URL.canParse(link)) return link;
  const url = new URL(link);
  const here = configuredHostedAppUrl();
  if (!builtHostedAppOrigins().includes(url.origin) || !URL.canParse(here)) return link;
  return `${new URL(here).origin}${url.pathname}${url.search}${url.hash}`;
}

/** The built hosted app's origin on each of our domains, the built one first. */
export const builtHostedAppOrigins = (): ReadonlyArray<string> => {
  const origin = originFromUrl(builtHostedAppUrl());
  return origin === null ? [] : ownDomainOrigins(origin);
};

function configuredBackendUrl(): string {
  return import.meta.env.VITE_HTTP_URL?.trim() || import.meta.env.VITE_WS_URL?.trim() || "";
}

function configuredHostedAppChannel(): HostedAppChannel | null {
  const channel = import.meta.env.VITE_HOSTED_APP_CHANNEL?.trim().toLowerCase();
  return channel === "latest" || channel === "nightly" ? channel : null;
}

function originFromUrl(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function isHostedStaticApp(url?: URL): boolean {
  if (configuredBackendUrl()) {
    return false;
  }

  if (configuredHostedAppChannel()) {
    return true;
  }

  if (url === undefined && (typeof window === "undefined" || window.location === undefined)) {
    return false;
  }

  return builtHostedAppOrigins().includes((url ?? new URL(window.location.href)).origin);
}

export function readHostedPairingRequest(url: URL = new URL(window.location.href)) {
  const host = url.searchParams.get("host")?.trim() ?? "";
  const token = getPairingTokenFromUrl(url)?.trim() ?? "";
  const label = url.searchParams.get("label")?.trim() ?? "";

  if (!host || !token) {
    return null;
  }

  return {
    host,
    token,
    label,
  } satisfies HostedPairingRequest;
}

const MAX_PAIRING_LABEL_LENGTH = 60;

/** The link names the computer, so its host and label are untrusted: show them as plain text only. */
export function describeHostedPairingRequest(
  request: HostedPairingRequest,
): { readonly origin: string; readonly label: string } | { readonly refused: string } {
  const host = request.host.replace(/^\/+/, "");
  const withScheme = /^[a-zA-Z][a-zA-Z\d+-]*:\/\//.test(host) ? host : `https://${host}`;
  if (!URL.canParse(withScheme))
    return { refused: "This link names an address that is not valid." };
  const url = new URL(withScheme);
  const secure = url.protocol === "https:" || url.protocol === "wss:";
  const insecureLocal =
    (url.protocol === "http:" || url.protocol === "ws:") && isLoopbackHost(url.hostname);
  if (!secure && !insecureLocal) {
    return { refused: "This link names a computer that does not use a secure (https) address." };
  }
  const label = Array.from(request.label.replace(/\p{Cc}|\p{Cf}/gu, "").trim());
  return {
    origin: url.origin,
    label:
      label.length > MAX_PAIRING_LABEL_LENGTH
        ? `${label.slice(0, MAX_PAIRING_LABEL_LENGTH).join("")}…`
        : label.join(""),
  };
}

let heldRequest: HostedPairingRequest | null = null;

/**
 * The pairing request this visit to /pair arrived with. The page takes the token out of the
 * address bar, and the router runs its guards again on that change: holding the request keeps
 * the page from losing it and falling back to the home page. Leaving /pair forgets it.
 */
export function hostedPairingRequestOn(
  pathname: string,
  url: URL = new URL(window.location.href),
): HostedPairingRequest | null {
  if (pathname !== "/pair") {
    heldRequest = null;
    return null;
  }
  heldRequest = readHostedPairingRequest(url) ?? heldRequest;
  return heldRequest;
}

export function buildHostedPairingUrl(input: {
  readonly host: string;
  readonly token: string;
  readonly label?: string | null;
}): string {
  const url = new URL("/pair", configuredHostedAppUrl());
  url.searchParams.set("host", input.host);

  const label = input.label?.trim();
  if (label) {
    url.searchParams.set("label", label);
  }

  return setPairingTokenOnUrl(url, input.token).toString();
}

export function buildHostedChannelSelectionUrl(input: {
  readonly channel: HostedAppChannel;
}): string {
  const url = new URL("/__t3code/channel", configuredHostedAppUrl());
  url.searchParams.set("channel", input.channel);
  return url.toString();
}
