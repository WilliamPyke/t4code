import { ownDomainOrigins } from "./ownDomains.ts";
import { readHashParams } from "./remote.ts";

const CONNECT_AUTH_STATE_PARAM = "state";
const CONNECT_AUTH_CHALLENGE_PARAM = "challenge";
const CONNECT_AUTH_PORT_PARAM = "port";
const CONNECT_AUTH_COMPUTER_PARAM = "computer";
const CONNECT_LOOPBACK_CALLBACK_PATH = "/callback";
// The approval page shows it; anything longer is not a computer name.
const COMPUTER_NAME_MAX_LENGTH = 64;

const CONNECT_AUTHORIZE_PATH = "/connect";

export const DEFAULT_HOSTED_APP_URL = "https://app.tinkjam.com";

/** Every origin the hosted app is served from, the current one first. */
export const HOSTED_APP_ORIGINS = ownDomainOrigins(DEFAULT_HOSTED_APP_URL);

export const CONNECT_OAUTH_SCOPES = ["openid", "profile", "email", "offline_access"] as const;

export interface ConnectAuthorizeRequest {
  readonly state: string;
  readonly challenge: string;
  readonly loopbackPort: number;
  /** Set by Tinkjam Sync, which asks to connect this computer rather than sign in a terminal. */
  readonly computerName?: string;
}

/** Route through /connect because Clerk's signed-out redirect can lose OAuth query parameters. */
export function buildConnectAuthorizeRequestUrl(input: {
  readonly hostedAppUrl: string;
  readonly state: string;
  readonly challenge: string;
  readonly loopbackPort: number;
  readonly computerName?: string;
}): string {
  const url = new URL(CONNECT_AUTHORIZE_PATH, input.hostedAppUrl);
  const computerName = normalizeComputerName(input.computerName ?? "");
  const params = new URLSearchParams([
    [CONNECT_AUTH_STATE_PARAM, input.state],
    [CONNECT_AUTH_CHALLENGE_PARAM, input.challenge],
    [CONNECT_AUTH_PORT_PARAM, String(input.loopbackPort)],
  ]);
  if (computerName !== null) params.set(CONNECT_AUTH_COMPUTER_PARAM, computerName);
  url.hash = params.toString();
  return url.toString();
}

export function readConnectAuthorizeRequest(url: URL): ConnectAuthorizeRequest | null {
  const params = readHashParams(url);
  const state = params.get(CONNECT_AUTH_STATE_PARAM)?.trim() ?? "";
  const challenge = params.get(CONNECT_AUTH_CHALLENGE_PARAM)?.trim() ?? "";
  const loopbackPort = parseLoopbackPort(params.get(CONNECT_AUTH_PORT_PARAM)?.trim() ?? "");
  if (!state || !challenge || loopbackPort === null) {
    return null;
  }
  const computerName = normalizeComputerName(params.get(CONNECT_AUTH_COMPUTER_PARAM) ?? "");
  return { state, challenge, loopbackPort, ...(computerName === null ? {} : { computerName }) };
}

/** One printable line: the name is shown as plain text on the approval page. */
function normalizeComputerName(value: string): string | null {
  const name = value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (name === "") return null;
  return name.length > COMPUTER_NAME_MAX_LENGTH
    ? `${name.slice(0, COMPUTER_NAME_MAX_LENGTH - 1).trimEnd()}…`
    : name;
}

function parseLoopbackPort(value: string): number | null {
  if (!/^\d{1,5}$/.test(value)) {
    return null;
  }
  const port = Number(value);
  return port >= 1 && port <= 65535 ? port : null;
}

/** Must match the loopback redirect URI registered on the Clerk CLI OAuth app. */
export function connectLoopbackRedirectUri(port: number): string {
  return `http://127.0.0.1:${port}${CONNECT_LOOPBACK_CALLBACK_PATH}`;
}

export function buildConnectClerkAuthorizeUrl(input: {
  readonly authorizationEndpoint: string;
  readonly clientId: string;
  readonly redirectUri: string;
  readonly scopes: ReadonlyArray<string>;
  readonly state: string;
  readonly challenge: string;
}): string {
  const url = new URL(input.authorizationEndpoint);
  url.searchParams.set("client_id", input.clientId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", input.scopes.join(" "));
  url.searchParams.set("state", input.state);
  url.searchParams.set("code_challenge", input.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}
