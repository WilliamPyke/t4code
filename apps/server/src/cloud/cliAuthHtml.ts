const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Where a person's boards are when the caller does not say; a fork passes its own.
const DEFAULT_BOARDS_URL = "https://app.trellium.org/";

/** The page the browser lands on once it approved this computer: done, and the way back. */
export function renderLoopbackAuthorizationCompleteHtml(
  input: { readonly boardsUrl?: string } = {},
): string {
  return renderPage(
    "Connected to Tinkjam",
    `<h1>This computer is connected</h1>
      <p class="description">Tinkjam Sync finishes setting up by itself. Go back to your board and press Bring my agent; this computer is in the list.</p>
      <a class="button" href="${escapeHtml(input.boardsUrl ?? DEFAULT_BOARDS_URL)}">Back to your boards</a>
      <p class="fine">You can close this window.</p>`,
  );
}

/** An approval that came back stale or refused: nothing was connected, and how to start again. */
export function renderLoopbackAuthorizationFailedHtml(): string {
  return renderPage(
    "Not connected",
    `<h1>This computer was not connected</h1>
      <p class="description">This approval link is no longer valid, or the approval was not given. Nothing changed on your account.</p>
      <p class="description">To start again, open Tinkjam Sync on this computer and choose Connect.</p>`,
  );
}

/**
 * The first page a person opens from Tinkjam Sync. It goes straight on to the hosted page, which
 * says what connecting does; the link is for a browser that does not follow by itself.
 */
export function renderLoopbackAuthorizationStartHtml(input: {
  readonly computerName: string;
  readonly continueUrl: string;
}): string {
  const computer = escapeHtml(input.computerName);
  const continueUrl = escapeHtml(input.continueUrl);
  return renderPage(
    `Connect ${computer} to Tinkjam`,
    `<h1>Opening Tinkjam…</h1>
      <p class="description">Taking you to Tinkjam to connect ${computer}.</p>
      <a class="button" href="${continueUrl}">Continue</a>`,
    `<meta http-equiv="refresh" content="0;url=${continueUrl}" />`,
  );
}

function renderPage(title: string, body: string, head = ""): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <title>${title}</title>
    ${head}
    <style>
      :root {
        --bg: #fff7ec;
        --card: #ffffff;
        --ink: #1d1a22;
        --muted: #5d5864;
        --line: rgba(29, 26, 34, 0.12);
        --jam: #db2d55;
        color-scheme: light dark;
        font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --bg: #17151b;
          --card: #221f27;
          --ink: #f6f1ea;
          --muted: #b3acb9;
          --line: rgba(255, 255, 255, 0.12);
        }
      }
      * { box-sizing: border-box; }
      body {
        min-height: 100vh;
        margin: 0;
        display: grid;
        place-items: center;
        padding: 32px 16px;
        background: var(--bg);
        color: var(--ink);
      }
      main {
        width: min(100%, 480px);
        border: 1px solid var(--line);
        border-radius: 20px;
        background: var(--card);
        padding: 28px 28px 30px;
        box-shadow: 0 18px 48px rgba(29, 26, 34, 0.12);
      }
      .brand {
        margin: 0 0 18px;
        color: var(--jam);
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.04em;
      }
      h1 { margin: 0; font-size: clamp(24px, 5vw, 30px); line-height: 1.15; letter-spacing: -0.02em; }
      p.description { margin: 12px 0 0; color: var(--muted); font-size: 15px; line-height: 1.6; }
      p.fine { margin: 16px 0 0; color: var(--muted); font-size: 13px; }
      a.button {
        display: inline-block;
        margin-top: 22px;
        border-radius: 10px;
        background: var(--jam);
        color: #fff;
        padding: 10px 18px;
        font-weight: 600;
        text-decoration: none;
      }
    </style>
  </head>
  <body>
    <main>
      <p class="brand">Tinkjam</p>
      ${body}
    </main>
  </body>
</html>`;
}
