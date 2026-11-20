import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  buildHostedPairingUrl,
  configuredHostedAppUrl,
  hostedPairingRequestOn,
  isHostedStaticApp,
  onThisHostedApp,
  readHostedPairingRequest,
} from "./hostedPairing";

describe("hostedPairing", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("names the hosted app on whichever of our domains the page is on", () => {
    vi.stubEnv("VITE_HOSTED_APP_URL", "https://app.tinkjam.com");
    const on = (href: string | null) => {
      vi.stubGlobal("window", href === null ? undefined : { location: new URL(href) });
      return configuredHostedAppUrl();
    };
    expect(on("https://app.trellium.org/b/1")).toBe("https://app.trellium.org");
    expect(on("https://app.tinkjam.com/b/1")).toBe("https://app.tinkjam.com");
    // Anywhere else (the desktop app, a dev server, a stranger) gets the configured one.
    for (const href of ["t3code://app/index.html", "http://localhost:5733/", "https://x.test/"]) {
      expect(on(href), href).toBe("https://app.tinkjam.com");
    }
    expect(on(null)).toBe("https://app.tinkjam.com");
    expect(isHostedStaticApp(new URL("https://app.trellium.org/"))).toBe(true);
    expect(isHostedStaticApp(new URL("https://app.trellium.org.evil.test/"))).toBe(false);
    vi.stubGlobal("window", { location: new URL("https://app.trellium.org/") });
    expect(new URL(buildHostedPairingUrl({ host: "box.example.com", token: "t" })).origin).toBe(
      "https://app.trellium.org",
    );
    // A computer built for the new domain still hands this page links on its own one.
    expect(onThisHostedApp("https://app.tinkjam.com/r/tulip-otter#x")).toBe(
      "https://app.trellium.org/r/tulip-otter#x",
    );
    expect(onThisHostedApp("https://sam.example.org/guest#x")).toBe(
      "https://sam.example.org/guest#x",
    );
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
