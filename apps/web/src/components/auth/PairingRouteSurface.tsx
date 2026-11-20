import { Alert, AlertDescription } from "../ui/alert";
import type { AuthSessionState } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import React, { startTransition, useEffect, useEffectEvent, useRef, useState } from "react";

import { connectPairing } from "../../connection/onboarding";
import {
  peekPairingTokenFromUrl,
  stripPairingTokenFromUrl,
  submitServerAuthCredential,
} from "../../environments/primary";
import { describeHostedPairingRequest, hostedPairingRequestOn } from "../../hostedPairing";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { StandalonePage, StandalonePageHeader } from "../ui/standalone-page";
import { useAtomCommand } from "../../state/use-atom-command";

export function PairingPendingSurface() {
  return (
    <StandalonePage>
      <StandalonePageHeader
        title="Pairing with this environment"
        description="Validating the pairing link and preparing your session."
      />
    </StandalonePage>
  );
}

export function PairingRouteSurface({
  auth,
  initialErrorMessage,
  onAuthenticated,
}: {
  auth: AuthSessionState["auth"];
  initialErrorMessage?: string;
  onAuthenticated: () => void;
}) {
  const [autoPairToken] = useState(peekPairingTokenFromUrl);
  const [credential, setCredential] = useState(autoPairToken ?? "");
  const [errorMessage, setErrorMessage] = useState(initialErrorMessage ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const autoSubmitAttemptedRef = useRef(false);

  const submitCredential = async (nextCredential: string) => {
    setIsSubmitting(true);
    setErrorMessage("");

    const submitError = await submitServerAuthCredential(nextCredential).then(
      () => null,
      (error) => errorMessageFromUnknown(error),
    );

    setIsSubmitting(false);

    if (submitError) {
      setErrorMessage(submitError);
      return;
    }

    startTransition(() => {
      onAuthenticated();
    });
  };

  const handleSubmit = async (event?: React.SubmitEvent<HTMLFormElement>) => {
    event?.preventDefault();
    await submitCredential(credential);
  };

  const autoSubmit = useEffectEvent((token: string) => {
    void submitCredential(token);
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- strips the pairing token from the URL and submits it once when the route carries one
  useEffect(() => {
    if (!autoPairToken || autoSubmitAttemptedRef.current) {
      return;
    }

    autoSubmitAttemptedRef.current = true;
    stripPairingTokenFromUrl();
    autoSubmit(autoPairToken);
  }, [autoPairToken]);

  return (
    <StandalonePage>
      <StandalonePageHeader
        title="Pair with this environment"
        description={describeAuthGate(auth.bootstrapMethods)}
      />

      <form className="mt-6 space-y-4" onSubmit={(event) => void handleSubmit(event)}>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="pairing-token">
            Pairing token
          </label>
          <Input
            id="pairing-token"
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            disabled={isSubmitting}
            nativeInput
            onChange={(event) => setCredential(event.currentTarget.value)}
            placeholder="Paste a one-time token or pairing secret"
            spellCheck={false}
            value={credential}
          />
        </div>

        {errorMessage ? (
          <Alert variant="error">
            <AlertDescription>{errorMessage}</AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button disabled={isSubmitting} size="sm" type="submit">
            {isSubmitting ? "Pairing..." : "Continue"}
          </Button>
          <Button
            disabled={isSubmitting}
            onClick={() => window.location.reload()}
            size="sm"
            variant="outline"
          >
            Reload app
          </Button>
        </div>
      </form>

      <div className="mt-6 rounded-lg border border-border/70 bg-background/55 px-3 py-3 text-xs leading-relaxed text-muted-foreground">
        {describeSupportedMethods(auth.bootstrapMethods)}
      </div>
    </StandalonePage>
  );
}

export function HostedPairingRouteSurface() {
  const connectPairingEnvironment = useAtomCommand(connectPairing, {
    reportFailure: false,
  });
  const [request] = useState(() => hostedPairingRequestOn("/pair"));
  const target = request ? describeHostedPairingRequest(request) : null;
  const [status, setStatus] = useState<"confirm" | "pairing" | "paired" | "error">("confirm");
  const [message, setMessage] = useState("");
  const [canRetry, setCanRetry] = useState(false);
  const tokenStrippedRef = useRef(false);
  const tokenSubmittedRef = useRef(false);

  const submitHostedPairingRequest = async () => {
    if (!request || target === null || "refused" in target) return;

    if (tokenSubmittedRef.current) {
      setStatus("error");
      setMessage("This one-time pairing token was already submitted. Request a new pairing link.");
      setCanRetry(false);
      return;
    }

    setStatus("pairing");
    setMessage("Connecting to this computer.");
    setCanRetry(false);
    tokenSubmittedRef.current = true;

    const result = await connectPairingEnvironment({
      host: target.origin,
      pairingCode: request.token,
    });
    if (result._tag === "Success") {
      setStatus("paired");
      setMessage(`${target.label || "The computer"} is saved in this browser.`);
      return;
    }

    tokenSubmittedRef.current = false;
    setStatus("error");
    setCanRetry(true);
    setMessage(
      `${errorMessageFromUnknown(squashAtomCommandFailure(result))} If the computer accepted this one-time token, request a new pairing link before retrying.`,
    );
  };

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- removes the pairing token from the address bar once; nothing is sent until the person presses Connect
  useEffect(() => {
    if (tokenStrippedRef.current) return;
    tokenStrippedRef.current = true;
    stripPairingTokenFromUrl();
  }, []);

  if (!request || target === null || "refused" in target) {
    return (
      <StandalonePage>
        <StandalonePageHeader
          title="Can't use this link"
          description={
            target && "refused" in target
              ? target.refused
              : "This pairing link is missing its computer address or token."
          }
        />
      </StandalonePage>
    );
  }

  return (
    <StandalonePage>
      <StandalonePageHeader
        title={
          status === "paired"
            ? "Computer connected"
            : status === "error"
              ? "Connecting failed"
              : "Connect to this computer?"
        }
        description={
          status === "confirm"
            ? "Only connect to a computer you own or trust: your boards can send it prompts."
            : message
        }
      />

      <div className="mt-5 space-y-1 rounded-lg border border-border/70 bg-background/55 px-3 py-3 text-xs leading-relaxed text-muted-foreground">
        {target.label ? (
          <div className="truncate">
            Name: <span className="text-foreground/80">{target.label}</span>
          </div>
        ) : null}
        <div className="truncate">
          Address: <span className="font-mono text-foreground/80">{target.origin}</span>
        </div>
      </div>

      {status === "error" ? (
        <Alert variant="error" className="mt-5">
          <AlertDescription>
            Verify the computer is reachable from this browser, supports CORS for hosted clients,
            and is served over HTTPS.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-2">
        {status === "confirm" ? (
          <>
            <Button size="sm" onClick={() => void submitHostedPairingRequest()}>
              Connect to this computer
            </Button>
            <Button size="sm" variant="outline" onClick={() => (window.location.href = "/")}>
              Cancel
            </Button>
          </>
        ) : status === "pairing" ? (
          <Button disabled size="sm">
            Connecting...
          </Button>
        ) : canRetry ? (
          <Button size="sm" onClick={() => void submitHostedPairingRequest()}>
            Try again
          </Button>
        ) : null}
        {status === "paired" ? (
          <Button size="sm" variant="outline" onClick={() => (window.location.href = "/")}>
            Open app
          </Button>
        ) : null}
      </div>
    </StandalonePage>
  );
}

function errorMessageFromUnknown(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  return "Authentication failed.";
}

function describeAuthGate(bootstrapMethods: ReadonlyArray<string>): string {
  if (bootstrapMethods.includes("desktop-bootstrap")) {
    return "This environment expects a trusted pairing credential before the app can connect.";
  }

  return "Enter a pairing token to start a session with this environment.";
}

function describeSupportedMethods(bootstrapMethods: ReadonlyArray<string>): string {
  if (
    bootstrapMethods.includes("desktop-bootstrap") &&
    bootstrapMethods.includes("one-time-token")
  ) {
    return "Desktop-managed pairing and one-time pairing tokens are both accepted for this environment.";
  }

  if (bootstrapMethods.includes("desktop-bootstrap")) {
    return "This environment is desktop-managed. Open it from the desktop app or paste a bootstrap credential if one was issued explicitly.";
  }

  return "This environment accepts one-time pairing tokens. Pairing links can open this page directly, or you can paste the token here.";
}
