import { describe, expect, it } from "vite-plus/test";

import { type DirectResolver, resolveTunnelHost } from "./tunnelEndpointProbe.ts";

const notFound = () =>
  Promise.reject(Object.assign(new Error("queryA ENOTFOUND"), { code: "ENOTFOUND" }));

const resolver = (
  name: string,
  answers: { readonly v4?: ReadonlyArray<string>; readonly v6?: ReadonlyArray<string> },
): DirectResolver => ({
  name,
  resolve4: () => (answers.v4 ? Promise.resolve(answers.v4) : notFound()),
  resolve6: () => (answers.v6 ? Promise.resolve(answers.v6) : notFound()),
});

describe("resolveTunnelHost", () => {
  // The OS resolver cached "no such record" from before the tunnel existed (macOS keeps it for the
  // zone's negative TTL); the probe never asks it, only DNS servers directly.
  it("pins the first address a direct query finds, falling back to public DNS", async () => {
    expect(
      await resolveTunnelHost("prod-1.trellium.org", [
        resolver("this computer's DNS servers", {}),
        resolver("public DNS", { v4: ["104.21.0.1"] }),
      ]),
    ).toEqual({ kind: "resolved", address: "104.21.0.1", family: 4 });
    expect(
      await resolveTunnelHost("prod-1.trellium.org", [
        resolver("this computer's DNS servers", { v6: ["2606:4700::1"] }),
      ]),
    ).toEqual({ kind: "resolved", address: "2606:4700::1", family: 6 });
  });

  it("says which servers had no record when none does", async () => {
    expect(
      await resolveTunnelHost("prod-1.trellium.org", [
        resolver("this computer's DNS servers", {}),
        resolver("public DNS", {}),
      ]),
    ).toEqual({
      kind: "unresolved",
      reason:
        "prod-1.trellium.org does not resolve yet (this computer's DNS servers: ENOTFOUND; public DNS: ENOTFOUND)",
    });
  });
});
