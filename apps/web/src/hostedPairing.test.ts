import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  buildHostedPairingUrl,
  hostedPairingRequestOn,
  readHostedPairingRequest,
} from "./hostedPairing";

describe("hostedPairing", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads hosted pairing host and query token parameters", () => {
    const url = new URL("https://app.trellium.org/pair?host=100.64.1.2:3773&token=ABCD1234");

    expect(readHostedPairingRequest(url)).toEqual({
      host: "100.64.1.2:3773",
      token: "ABCD1234",
      label: "",
    });
  });

  it("keeps a visit's request at /pair after its token leaves the address bar", () => {
    const linked = new URL("https://app.trellium.org/pair?host=box.example.com&label=PC#token=t1");
    const request = { host: "box.example.com", token: "t1", label: "PC" };
    expect(hostedPairingRequestOn("/pair", linked)).toEqual(request);
    // The page strips the token, and the router runs the root guard again on that change.
    const stripped = new URL("https://app.trellium.org/pair?host=box.example.com&label=PC");
    expect(hostedPairingRequestOn("/pair", stripped)).toEqual(request);
    expect(hostedPairingRequestOn("/", stripped)).toBeNull();
    expect(hostedPairingRequestOn("/pair", stripped)).toBeNull();
  });

  it("prefers hash tokens so generated hosted links do not put credentials in search params", () => {
    vi.stubEnv("VITE_HOSTED_APP_URL", "https://preview.t3.codes");

    const url = new URL(
      buildHostedPairingUrl({
        host: "https://backend.example.com:3773",
        token: "pairing-token",
        label: "Workstation",
      }),
    );

    expect(url.origin).toBe("https://preview.t3.codes");
    expect(url.pathname).toBe("/pair");
    expect(url.searchParams.get("host")).toBe("https://backend.example.com:3773");
    expect(url.searchParams.get("label")).toBe("Workstation");
    expect(url.searchParams.has("token")).toBe(false);
    expect(url.hash).toBe("#token=pairing-token");
  });
});
