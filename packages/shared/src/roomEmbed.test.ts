import { describe, expect, it } from "vite-plus/test";

import { isRoomEmbedFrameUrl, roomEmbedOf } from "./roomEmbed.ts";

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
      "ENG-123 fix the login loop",
      undefined,
    ],
    ["https://github.com/acme/app/issues/12", "github", "Issue acme/app#12", undefined],
    ["https://github.com/acme/app/blob/main/src/a.ts", "github", "src/a.ts in acme/app", undefined],
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
    ["https://example.com/spec", "web", "example.com", undefined],
  ])("reads %s", (url, source, title, embedUrl) => {
    const embed = roomEmbedOf(url);
    expect(embed?.source).toBe(source);
    expect(embed?.title).toBe(title);
    expect(embed?.embedUrl).toBe(embedUrl);
    if (embedUrl !== undefined) expect(isRoomEmbedFrameUrl(embedUrl)).toBe(true);
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
