import type { DpopFailureReason } from "@t3tools/contracts";
import type { RelayEnvironmentStatusResponse, RelayProtectedError } from "@t3tools/contracts/relay";

export const DPOP_CLOCK_HINT =
  "Hint: Check that automatic date and time is enabled on both devices, then try again.";

/** Older servers omit the DPoP category, but newer servers can also omit it for
 * a credential failure that happens after proof verification. */
export const DPOP_UNKNOWN_HINT =
  "Hint: Try again. If it still fails, clock skew may be the cause; check that automatic date and time is enabled on both devices.";

export const DPOP_RETRY_HINT = "Hint: Try again. If the problem continues, copy the trace ID.";

function dpopFailureHint(reason: DpopFailureReason | undefined): string {
  if (reason === "time_window") return DPOP_CLOCK_HINT;
  if (reason === undefined) return DPOP_UNKNOWN_HINT;
  return DPOP_RETRY_HINT;
}

export function dpopFailureMessage(message: string, reason: DpopFailureReason | undefined): string {
  return `${message} ${dpopFailureHint(reason)}`;
}

export function relayProtectedErrorMessage(error: RelayProtectedError): string {
  switch (error._tag) {
    case "RelayAuthInvalidError":
      switch (error.reason) {
        case "missing_bearer":
        case "invalid_bearer":
          return "Tinkjam could not confirm your sign-in. Sign out and back in, then try again.";
        case "invalid_dpop":
          return dpopFailureMessage(
            "Tinkjam could not confirm this device's request.",
            error.dpopFailureReason,
          );
        case "not_authorized":
          return "Your account is not allowed to do this.";
      }
    case "RelayEnvironmentLinkProofExpiredError":
      return "The computer's request to connect expired before it arrived. Check that its date and time are set automatically, then try again.";
    case "RelayEnvironmentLinkProofInvalidError":
      return `Tinkjam did not accept the computer's request to connect (${error.reason}). Update Tinkjam on that computer and try again.`;
    case "RelayEnvironmentConnectNotAuthorizedError":
      // "Not authorized" covers non-auth causes too; say which, so a removed
      // computer does not read as a sign-in problem.
      if (error.reason === "environment_link_not_found") {
        return "This computer is no longer on your Tinkjam account. Connect it again from that computer.";
      }
      if (error.reason === "managed_endpoint_allocation_not_ready") {
        return "This computer's connection is still being set up.";
      }
      if (error.reason === "endpoint_provider_not_managed") {
        return "This environment is linked only to publish agent activity, so it cannot accept connections. On that computer, open Settings > Sharing & access and turn Tinkjam Connect on.";
      }
      return error.reason
        ? `Tinkjam did not allow the connection to this computer (${error.reason}).`
        : "Tinkjam did not allow the connection to this computer.";
    case "RelayEnvironmentEndpointUnavailableError":
      return `Tinkjam could not reach this computer (${error.reason}). Check that it is on, online, and running Tinkjam.`;
    case "RelayEnvironmentEndpointTimedOutError":
      return "This computer did not answer in time. Check that it is on, online, and running Tinkjam.";
    case "RelayEnvironmentLinkFailedError":
      return `Tinkjam could not save this computer's connection (${error.reason}). Try again in a minute.`;
    case "RelayEnvironmentLinkUnavailableError":
      return `Tinkjam could not set up this computer's connection (${error.reason}${
        error.provisioningStage ? `, at ${error.provisioningStage}` : ""
      }). Try again in a minute.`;
    case "RelayEnvironmentLinkLimitExceededError":
      return `Your account already has its maximum of ${error.maxTunnels} connected computers. Remove a computer you no longer use in Settings, then try again.`;
    case "RelayEnvironmentLinkRemovedError":
      return "This computer was removed from your Tinkjam account. Connect it again to use it.";
    case "RelayAgentActivityPublishProofExpiredError":
      return "The computer's update arrived too late to be accepted. Check that its date and time are set automatically.";
    case "RelayAgentActivityPublishProofInvalidError":
      return `Tinkjam did not accept an update from the computer (${error.reason}).`;
    case "RelayInternalError":
      return `Relay encountered an internal error (${error.reason}).`;
  }
}

// The relay cuts off a request it cannot finish in time with a 504 that no
// endpoint declares, so the client sees only the status.
export const RELAY_GATEWAY_TIMEOUT_MESSAGE =
  "Tinkjam took too long to answer (HTTP 504). Try again in a few minutes. If it keeps failing, copy the trace ID when you report it.";

export function relayRequestFailureDetail(error: {
  readonly relayError?: RelayProtectedError | undefined;
  readonly status?: number | undefined;
}): string | null {
  if (error.relayError) return relayProtectedErrorMessage(error.relayError);
  if (error.status === 504) return RELAY_GATEWAY_TIMEOUT_MESSAGE;
  if (error.status !== undefined)
    return `Tinkjam answered with an unexpected HTTP ${error.status}.`;
  return null;
}

const RELAY_TUNNEL_RELEASED_MESSAGE =
  "Offline for a while, so its connection was put away. It comes back by itself a minute or two after Tinkjam starts on that computer.";

export function relayOfflineReasonMessage(
  status: Pick<RelayEnvironmentStatusResponse, "offlineReason">,
): string | null {
  switch (status.offlineReason) {
    case "tunnel_released":
      return RELAY_TUNNEL_RELEASED_MESSAGE;
    case undefined:
      return null;
  }
}
