import {
  buildConnectClerkAuthorizeUrl,
  connectLoopbackRedirectUri,
  CONNECT_OAUTH_SCOPES,
  type ConnectAuthorizeRequest,
} from "@t3tools/shared/connectAuth";
import { clerkFrontendApiUrlFromPublishableKey } from "@t3tools/shared/relayAuth";

import { isHostedStaticApp } from "../hostedPairing";
import {
  hasCloudPublicConfig,
  resolveCloudPublicConfig,
  resolveRelayClerkTokenOptions,
  trimNonEmpty,
} from "./publicConfig";

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

/**
 * Records on the relay that the signed-in person approved this sign-in. Only the computer holding
 * its verifier can redeem that, once; without it, the relay links no new or removed computer.
 */
export async function approveComputerSignIn(input: {
  readonly getToken: (
    options: ReturnType<typeof resolveRelayClerkTokenOptions>,
  ) => Promise<string | null>;
  readonly codeChallenge: string;
}): Promise<boolean> {
  const { relayUrl } = resolveCloudPublicConfig();
  if (!relayUrl) return false;
  try {
    const token = await input.getToken(resolveRelayClerkTokenOptions());
    if (!token) return false;
    const response = await fetch(new URL("/v1/client/computer-approvals", relayUrl), {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ codeChallenge: input.codeChallenge }),
    });
    // A relay from before approvals neither has this route nor asks for one.
    return response.ok || response.status === 404;
  } catch {
    return false;
  }
}
