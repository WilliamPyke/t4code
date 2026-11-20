import { describe, expect, it } from "vite-plus/test";

import {
  buildConnectAuthorizeRequestUrl,
  connectLoopbackRedirectUri,
  HOSTED_APP_ORIGINS,
  readConnectAuthorizeRequest,
} from "./connectAuth.ts";
import { ownDomainHosts, ownDomainOrigins } from "./ownDomains.ts";

describe("own domains", () => {
  it("names the same host on each of our domains, and nothing for anyone else's", () => {
    expect(HOSTED_APP_ORIGINS).toEqual(["https://app.tinkjam.com", "https://app.trellium.org"]);
    expect(ownDomainHosts("boards.trellium.org")).toEqual([
      "boards.trellium.org",
      "boards.tinkjam.com",
    ]);
    expect(ownDomainHosts("BOARDS.tinkjam.com.")).toEqual([
      "boards.tinkjam.com",
      "boards.trellium.org",
    ]);
    expect(ownDomainHosts("tinkjam.com")).toEqual(["tinkjam.com", "trellium.org"]);
    for (const host of ["eviltinkjam.com", "trellium.org.evil.io", "app.t3.test"]) {
      expect(ownDomainHosts(host), host).toEqual([host]);
    }
    expect(ownDomainOrigins("https://app.trellium.org")).toEqual([
      "https://app.trellium.org",
      "https://app.tinkjam.com",
    ]);
    expect(ownDomainOrigins("http://localhost:5733")).toEqual(["http://localhost:5733"]);
  });
});

describe("connectAuth", () => {
  it("round-trips state, challenge, and loopback port through the authorize URL fragment", () => {
    const url = buildConnectAuthorizeRequestUrl({
      hostedAppUrl: "https://app.trellium.org",
      state: "q7mK9xV2pL4nR8sT6wYzAQ",
      challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      loopbackPort: 34338,
    });
    const parsed = new URL(url);

    expect(parsed.origin).toBe("https://app.trellium.org");
    expect(parsed.pathname).toBe("/connect");
    expect(parsed.search).toBe("");
    expect(readConnectAuthorizeRequest(parsed)).toEqual({
      state: "q7mK9xV2pL4nR8sT6wYzAQ",
      challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
      loopbackPort: 34338,
    });
    expect(connectLoopbackRedirectUri(34338)).toBe("http://127.0.0.1:34338/callback");
  });

  it("carries the computer Tinkjam Sync asks to connect as one short line", () => {
    const request = {
      hostedAppUrl: "https://app.trellium.org",
      state: "state-1",
      challenge: "challenge-1",
      loopbackPort: 34338,
    };
    const named = (computerName: string) =>
      readConnectAuthorizeRequest(
        new URL(buildConnectAuthorizeRequestUrl({ ...request, computerName })),
      )?.computerName;
    expect(named("Ada's MacBook Pro")).toBe("Ada's MacBook Pro");
    expect(named("  two\nlines\u0007 ")).toBe("two lines");
    expect(named(" \n ")).toBeUndefined();
    expect(named("x".repeat(200))).toHaveLength(64);
    expect(
      readConnectAuthorizeRequest(new URL(buildConnectAuthorizeRequestUrl(request))),
    ).not.toHaveProperty("computerName");
  });

  it("rejects authorize requests missing state, challenge, or port", () => {
    expect(readConnectAuthorizeRequest(new URL("https://app.trellium.org/connect"))).toBeNull();
    expect(
      readConnectAuthorizeRequest(new URL("https://app.trellium.org/connect#state=abc&port=34338")),
    ).toBeNull();
    expect(
      readConnectAuthorizeRequest(
        new URL("https://app.trellium.org/connect#challenge=abc&port=34338"),
      ),
    ).toBeNull();
    expect(
      readConnectAuthorizeRequest(
        new URL("https://app.trellium.org/connect#state=abc&challenge=abc"),
      ),
    ).toBeNull();
  });

  it("rejects authorize requests whose loopback port is corrupted", () => {
    for (const port of ["", "abc", "-1", "0", "65536", "34338x", "34 38"]) {
      const url = new URL(
        `https://app.trellium.org/connect#state=state-1&challenge=challenge-1&port=${encodeURIComponent(port)}`,
      );
      expect(readConnectAuthorizeRequest(url), port).toBeNull();
    }
  });
});
