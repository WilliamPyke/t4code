import { describe, expect, it } from "vite-plus/test";

import { buildGuestLink, guestHostZoneOf, isGuestHostAllowed } from "./guestLinks.ts";

describe("buildGuestLink", () => {
  it("opens on the hosted app when there is one, and on the owner's host when there is not", () => {
    const link = { host: "sam.tunnel.test", credential: "share-1.signature" };
    expect(buildGuestLink({ ...link, hostedAppUrl: "https://app.tunnel.test" })).toBe(
      "https://app.tunnel.test/guest?host=sam.tunnel.test#share-1.signature",
    );
    expect(buildGuestLink({ ...link, hostedAppUrl: null })).toBe(
      "https://sam.tunnel.test/guest#share-1.signature",
    );
  });
});

describe("isGuestHostAllowed", () => {
  it("takes one label directly under the deployment's zone, and nothing else", () => {
    const zone = guestHostZoneOf("https://app.tunnel.test");
    expect(zone).toBe("tunnel.test");
    for (const host of ["sam.tunnel.test", "a-1.tunnel.test"]) {
      expect(isGuestHostAllowed(host, zone), host).toBe(true);
    }
    for (const host of [
      "tunnel.test",
      "evil.example",
      "sam.tunnel.test.evil.example",
      "eviltunnel.test",
      "a.b.tunnel.test",
      "sam.tunnel.test:8443",
      "sam.tunnel.test/path",
      "user@sam.tunnel.test",
      "SAM.tunnel.test",
      "-sam.tunnel.test",
      ".tunnel.test",
      "",
    ]) {
      expect(isGuestHostAllowed(host, zone), host).toBe(false);
    }
  });

  it("allows no host when the deployment names no zone", () => {
    // A hosted app on a bare domain has no parent zone to take tunnels from.
    expect(guestHostZoneOf("https://example.test")).toBeNull();
    expect(guestHostZoneOf("not a url")).toBeNull();
    expect(isGuestHostAllowed("sam.tunnel.test", null)).toBe(false);
    expect(isGuestHostAllowed("sam.tunnel.test", "")).toBe(false);
  });
});
