import { describe, expect, it } from "vite-plus/test";

import { frameCheck } from "./frameCheck.ts";

const pageOrigin = "https://app.tinkjam.com";
const ownHosts = ["app.tinkjam.com", "boards.tinkjam.com"];

/** Answers each address from `pages`, and keeps which ones were asked for. */
const checked = async (address: string, pages: Readonly<Record<string, Response>>) => {
  const asked: Array<string> = [];
  const verdict = await frameCheck({
    address,
    pageOrigin,
    ownHosts,
    fetcher: async (url) => {
      asked.push(String(url));
      const page = pages[String(url)];
      if (page === undefined) throw new Error("unreachable");
      return page;
    },
  });
  return { verdict, asked };
};

const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });

describe("frameCheck", () => {
  it("reads a page's headers, following its redirects", async () => {
    const start = "https://example.com/";
    expect(
      await checked(start, {
        [start]: redirect("/home"),
        "https://example.com/home": new Response("", {
          headers: { "x-frame-options": "SAMEORIGIN" },
        }),
      }),
    ).toEqual({ verdict: "refused", asked: [start, "https://example.com/home"] });
    expect((await checked(start, { [start]: new Response("") })).verdict).toBe("ok");
  });

  it("asks for no address the rule refuses, at the start or after a redirect", async () => {
    const ours = [pageOrigin, "https://app.trellium.org/b/1"];
    for (const inner of ["https://127.0.0.1/admin", "http://example.com/", ...ours]) {
      expect(await checked(inner, {})).toEqual({ verdict: "unknown", asked: [] });
      const start = "https://example.com/";
      expect(await checked(start, { [start]: redirect(inner) })).toEqual({
        verdict: "unknown",
        asked: [start],
      });
    }
  });

  it("does not know when the site fails, errors or keeps redirecting", async () => {
    const start = "https://example.com/";
    expect((await checked(start, {})).verdict).toBe("unknown");
    const denied = new Response("", { status: 403, headers: { "x-frame-options": "DENY" } });
    expect((await checked(start, { [start]: denied })).verdict).toBe("unknown");
    // A bot wall's own page, which a browser may never get.
    for (const wall of [
      { status: 202, headers: { "x-frame-options": "DENY" } },
      { headers: { "x-frame-options": "DENY", "cf-mitigated": "challenge" } },
      { headers: { "x-frame-options": "DENY", "x-amzn-waf-action": "challenge" } },
    ]) {
      expect((await checked(start, { [start]: new Response("", wall) })).verdict).toBe("unknown");
    }
    const loop = await checked(start, {
      [start]: redirect("https://example.com/a"),
      "https://example.com/a": redirect("https://example.com/b"),
      "https://example.com/b": redirect("https://example.com/c"),
      "https://example.com/c": redirect("https://example.com/d"),
    });
    expect(loop).toMatchObject({ verdict: "unknown" });
    expect(loop.asked).toHaveLength(4);
  });
});
