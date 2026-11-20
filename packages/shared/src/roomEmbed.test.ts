import { describe, expect, it } from "vite-plus/test";

import {
  isRoomEmbedFrameUrl,
  isRoomEmbedPersonFrameUrl,
  roomEmbedBringInPrompt,
  roomEmbedFrameVerdict,
  roomEmbedOf,
  roomEmbedReadHint,
} from "./roomEmbed.ts";

describe("roomEmbedOf", () => {
  it.each([
    [
      "https://www.figma.com/design/BAZsTPbh6W1r66Bdo/Checkout-flow?node-id=2654-15&t=abc",
      "figma",
      "Checkout flow",
      "https://embed.figma.com/design/BAZsTPbh6W1r66Bdo?embed-host=tinkjam&node-id=2654-15",
    ],
    [
      "https://www.figma.com/file/BAZsTPbh6W1r66Bdo/Old-file",
      "figma",
      "Old file",
      "https://embed.figma.com/design/BAZsTPbh6W1r66Bdo?embed-host=tinkjam",
    ],
    [
      "https://figma.com/board/AZBcScMePxSpiX9j/Retro",
      "figma",
      "Retro",
      "https://embed.figma.com/board/AZBcScMePxSpiX9j?embed-host=tinkjam",
    ],
    [
      "https://www.figma.com/proto/AZBcScMePxSpiX9j",
      "figma",
      "Figma prototype",
      "https://embed.figma.com/proto/AZBcScMePxSpiX9j?embed-host=tinkjam",
    ],
    [
      "https://www.figma.com/design/MainKey123/branch/BranchKey456/Login",
      "figma",
      "Login",
      "https://embed.figma.com/design/BranchKey456?embed-host=tinkjam",
    ],
    [
      "https://docs.google.com/document/d/1AbC-dEf_123/edit?tab=t.0",
      "google-docs",
      "Google Doc",
      "https://docs.google.com/document/d/1AbC-dEf_123/preview",
    ],
    [
      "https://docs.google.com/spreadsheets/d/1AbC-dEf_123/edit#gid=0",
      "google-sheets",
      "Google Sheet",
      "https://docs.google.com/spreadsheets/d/1AbC-dEf_123/preview",
    ],
    [
      "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ/pubhtml",
      "google-sheets",
      "Google Sheet",
      "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ/pubhtml?widget=true&headers=false",
    ],
    [
      "https://docs.google.com/presentation/d/1AbC-dEf_123/edit#slide=id.p",
      "google-slides",
      "Google Slides presentation",
      "https://docs.google.com/presentation/d/1AbC-dEf_123/preview",
    ],
    [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s",
      "youtube",
      "YouTube video",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=42",
    ],
    [
      "https://youtu.be/dQw4w9WgXcQ",
      "youtube",
      "YouTube video",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    ],
    [
      "https://www.loom.com/share/Sprint-demo-0123456789abcdef0123456789abcdef?sid=1",
      "loom",
      "Sprint demo",
      "https://www.loom.com/embed/0123456789abcdef0123456789abcdef",
    ],
    [
      "https://vimeo.com/76979871/af45c2d1b2",
      "vimeo",
      "Vimeo video",
      "https://player.vimeo.com/video/76979871?h=af45c2d1b2",
    ],
    [
      "https://claude.ai/public/artifacts/0a1b2c3d-4e5f-6789-abcd-ef0123456789",
      "claude-artifact",
      "Claude artifact",
      undefined,
    ],
    [
      "https://linear.app/acme/issue/ENG-123/fix-the-login-loop",
      "linear",
      "ENG-123 · Fix the login loop",
      undefined,
    ],
    ["https://github.com/acme/app/issues/12", "github", "acme/app #12", undefined],
    ["https://github.com/acme/app/blob/main/src/a.ts", "github", "src/a.ts", undefined],
    [
      "https://docs.superhuman.com/d/Team-wiki_dAbC12/Launch-plan_suXyZ9",
      "superhuman",
      "Launch plan",
      undefined,
    ],
    ["https://coda.io/d/Roadmap_dQ1w2e3", "coda", "Roadmap", undefined],
    [
      "https://www.notion.so/acme/Q3-Roadmap-0123456789abcdef0123456789abcdef",
      "notion",
      "Q3 Roadmap",
      undefined,
    ],
    [
      "https://acme.notion.site/0123456789abcdef0123456789abcdef",
      "notion",
      "Notion page",
      undefined,
    ],
    ["https://acme.atlassian.net/browse/OPS-7", "jira", "OPS-7", undefined],
    ["https://app.asana.com/0/123/456", "asana", "Asana task", undefined],
    ["https://miro.com/app/board/uXjVabc=/", "miro", "Miro board", undefined],
    ["https://example.com/spec", "web", "Spec", undefined],
    ["https://www.example.com/", "web", "example.com", undefined],
  ])("reads %s", (url, source, title, embedUrl) => {
    const embed = roomEmbedOf(url);
    expect(embed?.source).toBe(source);
    expect(embed?.title).toBe(title);
    expect(embed?.embedUrl).toBe(embedUrl);
    if (embedUrl !== undefined) expect(isRoomEmbedFrameUrl(embedUrl)).toBe(true);
  });

  it.each([
    ["https://linear.app/acme/issue/ENG-123/fix-login", "ENG-123 · Fix login", "Linear issue"],
    ["https://linear.app/acme/issue/ENG-9", "ENG-9", "Linear issue"],
    [
      "https://linear.app/acme/project/q3-roadmap-8f2a1b3c4d5e/overview",
      "Q3 roadmap",
      "Linear project",
    ],
    ["https://github.com/pingdotgg/t3code/issues/1", "pingdotgg/t3code #1", "GitHub issue"],
    ["https://github.com/pingdotgg/t3code/pull/42", "pingdotgg/t3code #42", "GitHub pull request"],
    ["https://github.com/acme/app/tree/main/docs", "docs", "Folder in acme/app"],
    ["https://github.com/acme/app/commit/0123456789abcdef", "acme/app @ 0123456", "GitHub commit"],
    ["https://github.com/acme/app", "acme/app", "GitHub repository"],
    ["https://www.figma.com/board/AZBcScMePxSpiX9j/Retro", "Retro", "FigJam board"],
    ["https://youtu.be/dQw4w9WgXcQ", "YouTube video", "YouTube video"],
    ["https://acme.atlassian.net/browse/OPS-7", "OPS-7", "Jira issue"],
    // Any other site: named from its address's last name, and labelled with its host.
    [
      "https://blog.example.com/2024/05/how-we-ship-fast.html",
      "How we ship fast",
      "blog.example.com",
    ],
    ["https://example.com/posts/123456/", "Posts", "example.com"],
    ["https://www.example.com/a/0123456789abcdef0123", "A", "example.com"],
    ["http://intranet.local/Team-Wiki", "Team Wiki", "intranet.local"],
  ])("titles %s as %s, a %s", (url, title, kind) => {
    const embed = roomEmbedOf(url);
    expect(embed?.title).toBe(title);
    expect(embed?.kind).toBe(kind);
  });

  it("refuses anything but an http or https address", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "figma.com/design/abc",
      "",
    ]) {
      expect(roomEmbedOf(url)).toBeNull();
    }
  });

  it("frames only plain https on the source's own host", () => {
    for (const url of [
      "http://www.figma.com/design/BAZsTPbh6W1r66Bdo/x",
      "https://figma.com.evil.test/design/BAZsTPbh6W1r66Bdo/x",
      "https://evilfigma.com/design/BAZsTPbh6W1r66Bdo/x",
      "https://www.figma.com@evil.test/design/BAZsTPbh6W1r66Bdo/x",
      "https://user:pass@www.figma.com/design/BAZsTPbh6W1r66Bdo/x",
      "https://www.figma.com:8443/design/BAZsTPbh6W1r66Bdo/x",
      "https://docs.google.com.evil.test/document/d/abc/edit",
      "https://www.youtube.com/watch?v=../../evil",
      "https://www.figma.com/design/..%2F..%2Fevil/x",
      "https://notion.site.evil.test/Page-0123456789abcdef0123456789abcdef",
    ]) {
      const embed = roomEmbedOf(url);
      expect(embed?.embedUrl, url).toBeUndefined();
    }
    expect(roomEmbedOf("https://figma.com.evil.test/design/k/x")?.source).toBe("web");
    expect(roomEmbedOf("https://www.figma.com@evil.test/design/k/x")?.name).toBe("evil.test");
  });
});

describe("isRoomEmbedFrameUrl", () => {
  it("takes only https on a frame host", () => {
    expect(isRoomEmbedFrameUrl("https://embed.figma.com/design/k?embed-host=tinkjam")).toBe(true);
    expect(isRoomEmbedFrameUrl("http://embed.figma.com/design/k")).toBe(false);
    expect(isRoomEmbedFrameUrl("https://embed.figma.com.evil.test/design/k")).toBe(false);
    expect(isRoomEmbedFrameUrl("https://www.figma.com/design/k")).toBe(false);
    expect(isRoomEmbedFrameUrl("javascript:alert(1)")).toBe(false);
  });
});

describe("isRoomEmbedPersonFrameUrl", () => {
  const own = ["app.tinkjam.com", "boards.tinkjam.com"];

  it.each([
    "https://example.com/pricing?plan=team#top",
    "https://docs.example.co.uk/guide",
    "https://github.com/acme/app",
  ])("lets a person frame %s", (url) => {
    expect(isRoomEmbedPersonFrameUrl(url, own)).toBe(true);
  });

  it.each([
    "http://example.com",
    "javascript:alert(1)",
    "data:text/html,hi",
    "not an address",
    "https://sam:secret@example.com",
    "https://sam@example.com",
    "https://example.com:8443",
    "https://127.0.0.1",
    "https://2130706433",
    "https://0x7f.1",
    "https://[::1]",
    "https://[2001:db8::1]/",
    "https://localhost",
    "https://app.localhost",
    "https://printer.local",
    "https://vault.corp.internal",
    "https://intranet",
    "https://localhost./",
    "https://tinkjam.com/boards",
    "https://app.tinkjam.com/settings",
    "https://BOARDS.tinkjam.com./api/boards",
    "https://other.tinkjam.com",
    "https://app.trellium.org/b/1",
    "https://boards.trellium.org/api/boards",
    "https://trellium.org/legal",
  ])("never frames %s", (url) => {
    expect(isRoomEmbedPersonFrameUrl(url, own)).toBe(false);
  });

  it("never frames either of our domains, even when the caller names no own hosts", () => {
    expect(isRoomEmbedPersonFrameUrl("https://app.tinkjam.com/b/1")).toBe(false);
    expect(isRoomEmbedPersonFrameUrl("https://app.trellium.org/b/1")).toBe(false);
    expect(isRoomEmbedPersonFrameUrl("https://tinkjam.com.example.org/")).toBe(true);
  });

  it("leaves the sources the board frames itself to their own rule", () => {
    expect(isRoomEmbedFrameUrl("https://example.com/pricing")).toBe(false);
  });
});

describe("roomEmbedFrameVerdict", () => {
  const page = "https://app.tinkjam.com";
  const verdict = (frameOptions: string | null, contentSecurityPolicy: string | null) =>
    roomEmbedFrameVerdict({ frameOptions, contentSecurityPolicy }, page);

  it.each([
    [null, null, "ok"],
    ["DENY", null, "refused"],
    ["SameOrigin", null, "refused"],
    ["ALLOW-FROM https://else.example", null, "ok"],
    [null, "default-src 'self'; script-src 'none'", "ok"],
    [null, "frame-ancestors 'none'", "refused"],
    [null, "default-src *; frame-ancestors 'self' https://partner.example", "refused"],
    [null, "frame-ancestors *", "ok"],
    [null, "frame-ancestors https:", "ok"],
    [null, "frame-ancestors 'self' https://*.tinkjam.com", "ok"],
    [null, "frame-ancestors app.tinkjam.com", "ok"],
    [null, "frame-ancestors https://tinkjam.com", "refused"],
    [null, "frame-ancestors https://app.tinkjam.com:443", "ok"],
    [null, "frame-ancestors https://app.tinkjam.com:8443", "refused"],
    [null, "frame-ancestors http:", "ok"],
    [null, "frame-ancestors https://*", "ok"],
    [null, "frame-ancestors *:443 'self'", "ok"],
    [null, "frame-ancestors http://*.tinkjam.com/embed", "ok"],
    [null, "frame-ancestors notion://app.tinkjam.com data:", "refused"],
    [null, "frame-ancestors", "refused"],
    [null, "frame-ancestors *; frame-ancestors 'none'", "ok"],
    ["DENY, SAMEORIGIN", null, "refused"],
    ["ALLOWALL", null, "ok"],
    // frame-ancestors decides over X-Frame-Options, and every policy has to allow it.
    ["DENY", "frame-ancestors *", "ok"],
    [null, "frame-ancestors *, frame-ancestors 'none'", "refused"],
  ] as const)("reads %s and %s as %s", (frameOptions, policy, expected) => {
    expect(verdict(frameOptions, policy)).toBe(expected);
  });
});

describe("roomEmbedReadHint", () => {
  it("asks each source for what a reader looks for first, and never to change it", () => {
    const cases: ReadonlyArray<readonly [string, RegExp]> = [
      ["https://linear.app/acme/issue/ENG-123/fix-login", /status, assignee, priority.*comments/],
      ["https://linear.app/acme/document/spec-0123456789ab", /outline/],
      ["https://github.com/acme/app/pull/12", /state, description.*changed files.*review status/],
      ["https://github.com/acme/app/issues/7", /state, .*description.*comments/],
      [
        "https://docs.google.com/spreadsheets/d/abc123/edit",
        /sheet names.*headers.*first rows.*table/,
      ],
      ["https://www.figma.com/design/AbC123/checkout", /page and frame names.*each frame shows/],
      ["https://docs.google.com/document/d/abc123/edit", /outline.*full text if it is short/],
      ["https://docs.superhuman.com/d/plan_dAbC", /outline/],
      ["https://www.notion.so/acme/Roadmap-0123456789abcdef0123456789abcdef", /outline/],
      ["https://coda.io/d/plan_dAbC", /outline/],
      ["https://acme.atlassian.net/browse/OPS-4", /status, assignee/],
      ["https://example.com/blog/launch", /title and main content/],
    ];
    for (const [url, expected] of cases) {
      const embed = roomEmbedOf(url);
      if (embed === null) throw new Error(url);
      const hint = roomEmbedReadHint(embed);
      expect(hint, url).toMatch(expected);
      expect(hint, url).not.toMatch(
        /\b(?:edit|modify|update|delete|remove|create|post|close|resolve|assign|move|rename)\b/i,
      );
    }
  });

  it("puts the link, the source's hint and a read-only rule in the prompt", () => {
    const prompt = roomEmbedBringInPrompt("https://linear.app/acme/issue/ENG-123/fix-login");
    expect(prompt).toContain("https://linear.app/acme/issue/ENG-123/fix-login");
    expect(prompt).toContain("For this Linear issue, include its status");
    expect(prompt).toContain("change nothing in the source");
    expect(prompt).toContain("say exactly what access is missing");
    expect(roomEmbedBringInPrompt("https://example.com/a")).toContain("For this page,");
  });
});
