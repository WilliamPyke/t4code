import { describe, expect, it } from "vite-plus/test";

import {
  renderLoopbackAuthorizationCompleteHtml,
  renderLoopbackAuthorizationFailedHtml,
  renderLoopbackAuthorizationStartHtml,
} from "./cliAuthHtml.ts";

const HOSTILE = `"><script>alert('x')</script>&`;
const ESCAPED = "&quot;&gt;&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt;&amp;";

describe("cliAuthHtml", () => {
  it("escapes the computer name and the addresses wherever a page shows them", () => {
    const pages = [
      renderLoopbackAuthorizationStartHtml({
        computerName: HOSTILE,
        continueUrl: `https://app.trellium.org/connect#computer=${HOSTILE}`,
      }),
      renderLoopbackAuthorizationCompleteHtml({
        computerName: HOSTILE,
        boardsUrl: `https://boards.example/${HOSTILE}`,
      }),
      renderLoopbackAuthorizationFailedHtml({ boardsUrl: `https://boards.example/${HOSTILE}` }),
    ];
    for (const page of pages) {
      expect(page).not.toContain("<script>");
      expect(page).not.toContain(HOSTILE);
      expect(page).toContain(ESCAPED);
    }
  });

  it("links only to web pages", () => {
    const pages = [
      renderLoopbackAuthorizationStartHtml({ computerName: "Pond", continueUrl: "javascript:1" }),
      renderLoopbackAuthorizationCompleteHtml({ boardsUrl: "javascript:1" }),
      renderLoopbackAuthorizationFailedHtml({ boardsUrl: "data:text/html,x" }),
    ];
    for (const page of pages) {
      expect(page).not.toMatch(/javascript:|data:/);
      expect(page).toContain('href="https://app.tinkjam.com/"');
    }
  });
});
