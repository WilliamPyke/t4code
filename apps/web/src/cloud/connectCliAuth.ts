import {
  buildConnectClerkAuthorizeUrl,
  connectLoopbackRedirectUri,
  CONNECT_OAUTH_SCOPES,
  type ConnectAuthorizeRequest,
} from "@t3tools/shared/connectAuth";
import { clerkFrontendApiUrlFromPublishableKey } from "@t3tools/shared/relayAuth";

import { isHostedStaticApp } from "../hostedPairing";
import { hasCloudPublicConfig, resolveCloudPublicConfig, trimNonEmpty } from "./publicConfig";

function resolveConnectCliOAuthClientId(): string | null {
  return trimNonEmpty(import.meta.env.VITE_CLERK_CLI_OAUTH_CLIENT_ID as string | undefined);
}

function hasConnectCliAuthConfig(): boolean {
  return Boolean(
    resolveCloudPublicConfig().clerkPublishableKey && resolveConnectCliOAuthClientId(),
  );
}

// A fork with its own sign-in has no hosted app, so its CLI points T3CODE_HOSTED_APP_URL at the local one.
function isLoopbackApp(): boolean {
  return ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
}

export function connectCliAuthRoutesEnabled(): boolean {
  return (
    (isHostedStaticApp() || isLoopbackApp()) && hasCloudPublicConfig() && hasConnectCliAuthConfig()
  );
}

export function buildConnectCliClerkAuthorizeUrl(request: ConnectAuthorizeRequest): string | null {
  const { clerkPublishableKey } = resolveCloudPublicConfig();
  const clientId = resolveConnectCliOAuthClientId();
  if (!clerkPublishableKey || !clientId) {
    return null;
  }
  return buildConnectClerkAuthorizeUrl({
    authorizationEndpoint: `${clerkFrontendApiUrlFromPublishableKey(clerkPublishableKey)}/oauth/authorize`,
    clientId,
    redirectUri: connectLoopbackRedirectUri(request.loopbackPort),
    scopes: CONNECT_OAUTH_SCOPES,
    state: request.state,
    challenge: request.challenge,
  });
}

const CONTINUE_PARAM = "continue";

/**
 * Back to /connect after sign-in, marked to continue. The query forces a new document (Clerk
 * suppresses post-sign-in updates on a fragment-only change), and leaving for Clerk's authorize
 * page from a signed-in page carries the session there instead of asking for it twice.
 */
export function connectCliSignInRedirectUrl(currentHref: string): string {
  const url = new URL(currentHref);
  url.searchParams.set(CONTINUE_PARAM, "1");
  return url.toString();
}

/** Whether this page was reached by signing in to approve, so it continues by itself. */
export function connectCliContinueRequested(href: string): boolean {
  return new URL(href).searchParams.get(CONTINUE_PARAM) === "1";
}
