import { describe, expect, it } from "vite-plus/test";

import { acceptedGuestLinkHost, cloudBoardsOriginOf, guestShareOriginOf } from "./cloudBoardsHost";

describe("cloudBoardsOriginOf", () => {
  it("takes the configured origin first, then boards. in the zone, else none", () => {
    expect(cloudBoardsOriginOf({ configured: "http://localhost:8799/", zone: "x.test" })).toBe(
      "http://localhost:8799",
    );
    expect(cloudBoardsOriginOf({ configured: " ", zone: "trellium.org" })).toBe(
      "https://boards.trellium.org",
    );
    expect(cloudBoardsOriginOf({ configured: undefined, zone: null })).toBeNull();
    expect(cloudBoardsOriginOf({ configured: "not a url", zone: "trellium.org" })).toBeNull();
  });
});

describe("guest link hosts", () => {
  const base = { pageHost: "app.tunnel.test", zone: "tunnel.test", cloudHost: "localhost:8799" };

  it("accepts the page, the zone's tunnels and the cloud host, and nothing else", () => {
    expect(acceptedGuestLinkHost({ ...base, requested: null })).toBe("app.tunnel.test");
    expect(acceptedGuestLinkHost({ ...base, requested: "sam.tunnel.test" })).toBe(
      "sam.tunnel.test",
    );
    expect(acceptedGuestLinkHost({ ...base, requested: "localhost:8799" })).toBe("localhost:8799");
    expect(acceptedGuestLinkHost({ ...base, requested: "localhost:8800" })).toBeNull();
    expect(acceptedGuestLinkHost({ ...base, cloudHost: null, requested: "localhost:8799" })).toBe(
      null,
    );
  });

  it("reaches the cloud host on its own origin, so plain http works for local testing", () => {
    const page = { host: "app.tunnel.test", origin: "https://app.tunnel.test" };
    const cloudOrigin = "http://localhost:8799";
    expect(guestShareOriginOf({ host: "localhost:8799", page, cloudOrigin })).toBe(cloudOrigin);
    expect(guestShareOriginOf({ host: "sam.tunnel.test", page, cloudOrigin })).toBe(
      "https://sam.tunnel.test",
    );
    expect(guestShareOriginOf({ host: "app.tunnel.test", page, cloudOrigin })).toBe(page.origin);
  });
});
