const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// Where a person's boards are when the caller does not say; a fork passes its own.
const DEFAULT_BOARDS_URL = "https://app.tinkjam.com/";

// A link on these pages only ever leaves for a web page.
const webUrl = (value: string | undefined, fallback: string) =>
  value !== undefined && /^https?:\/\//i.test(value) ? value : fallback;

const UNDO =
  "To stop, quit Tinkjam Sync. To undo this, open Settings on Tinkjam and remove this computer under Your computers.";

/** The page the browser lands on once it approved this computer: done, and the way back. */
export function renderLoopbackAuthorizationCompleteHtml(
  input: { readonly boardsUrl?: string; readonly computerName?: string } = {},
): string {
  const computer = input.computerName === undefined ? null : escapeHtml(input.computerName);
  return renderPage(
    "Connected to Tinkjam",
    `<h1>${computer ?? "This computer"} is approved</h1>
      <p class="description">Tinkjam Sync finishes setting up by itself, in a few moments. Go back to your board and press Bring my agent: this computer is in the list.</p>
      <a class="button" href="${escapeHtml(webUrl(input.boardsUrl, DEFAULT_BOARDS_URL))}">Back to your boards</a>
      <p class="fine">${UNDO} You can close this tab.</p>`,
  );
}

/** An approval that came back stale or refused: nothing was connected, and how to start again. */
export function renderLoopbackAuthorizationFailedHtml(
  input: { readonly boardsUrl?: string } = {},
): string {
  return renderPage(
    "Not connected",
    `<h1>This computer was not connected</h1>
      <p class="description">The link had expired or was already used, or the approval was not given. Nothing changed on your account.</p>
      <p class="description">To start again, open Tinkjam Sync on this computer and choose Connect.</p>
      <a class="button quiet" href="${escapeHtml(webUrl(input.boardsUrl, DEFAULT_BOARDS_URL))}">Go to your boards</a>`,
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
  const continueUrl = escapeHtml(webUrl(input.continueUrl, DEFAULT_BOARDS_URL));
  return renderPage(
    `Connect ${computer} to Tinkjam`,
    `<h1>Opening Tinkjam…</h1>
      <p class="description">Taking you to Tinkjam to connect ${computer}. If nothing happens, press Continue.</p>
      <a class="button" href="${continueUrl}">Continue</a>`,
    `<meta http-equiv="refresh" content="0;url=${continueUrl}" />`,
  );
}

// Tinkjam's mark and word, as apps/web draws them (public/tinkjam-mark.svg, TinkjamLogo.tsx).
const WORDMARK = `<span class="brand" role="img" aria-label="Tinkjam"><svg class="mark" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="15" fill="#DB2D55"/><path d="M37 12v27a10 10 0 0 1-10 10h-5" fill="none" stroke="#FFF7EC" stroke-width="9" stroke-linecap="round"/><rect x="20" y="20" width="32" height="10" rx="5" fill="#FFC83D"/><circle cx="16" cy="49" r="5.2" fill="#FFC83D"/></svg><svg class="word" viewBox="0 -24.48 108.83 30.26" aria-hidden="true"><g transform="scale(0.34)"><path fill="currentColor" d="M24.42 1.17Q15.35 1.17 10.89 -3.49Q6.43 -8.16 6.43 -17.92V-40.57H0.56V-50.43H1.09Q7.01 -51.18 9.5 -54.37Q11.99 -57.56 12.56 -64.02L12.61 -64.68H21.73V-52.68H33.99V-40.2H21.73V-19.32Q21.73 -15.51 23.58 -13.88Q25.43 -12.25 28.17 -12.25Q29.61 -12.25 31.14 -12.67Q32.68 -13.08 33.99 -13.82V-0.25Q30.98 0.64 28.62 0.91Q26.25 1.17 24.42 1.17Z M38.11 0V-52.68H53.6V0Z M59.01 0V-29.36L58.99 -52.68H72.17L72.02 -30.89H72.83Q73.43 -38.78 75.46 -43.9Q77.48 -49.01 81.21 -51.55Q84.94 -54.08 90.65 -54.08Q99.27 -54.08 103.6 -48.32Q107.93 -42.56 107.93 -31.08V0H92.44V-29.16Q92.44 -34.93 90.71 -37.79Q88.97 -40.65 85.17 -40.65Q81.99 -40.65 79.58 -38.43Q77.18 -36.21 75.84 -31.32Q74.5 -26.42 74.5 -18.27V0Z M112.81 0V-69.8H127.93V-32.65Q131.43 -34.4 134.03 -36.72Q136.63 -39.04 138.47 -41.73Q140.31 -44.43 141.45 -47.22Q142.59 -50.01 143.27 -52.69H161.02Q159.95 -48.75 157.88 -45.02Q155.81 -41.28 152.77 -38.02Q149.73 -34.75 145.75 -32.15Q141.76 -29.55 136.94 -27.87V-27.07Q143.16 -28.03 147.14 -27.24Q151.11 -26.46 153.44 -24.39Q155.76 -22.32 157.02 -19.23Q158.29 -16.13 159 -12.37L161.34 0H144.61L143.47 -8.72Q143.02 -12.05 142.22 -14.9Q141.42 -17.74 139.27 -19.5Q137.11 -21.25 132.6 -21.26L127.93 -21.27V0Z M164.6 16.21Q163.28 16.21 161.89 16.05Q160.5 15.89 159.05 15.65L157.8 2.49Q161.93 2.83 163.64 1.48Q165.36 0.13 165.36 -3.97V-52.68H180.85V-3.27Q180.85 2.03 179.64 5.74Q178.43 9.45 176.19 11.78Q173.95 14.11 171.01 15.16Q168.07 16.21 164.6 16.21Z M200.12 1.39Q196.11 1.39 192.53 -0.01Q188.95 -1.42 186.67 -4.57Q184.39 -7.71 184.39 -12.98Q184.39 -17.84 186.27 -20.87Q188.15 -23.91 191.34 -25.75Q194.52 -27.6 198.33 -28.56Q202.15 -29.51 205.92 -30.21Q211.17 -31.21 213.78 -31.8Q216.39 -32.4 217.33 -33.21Q218.27 -34.02 218.27 -35.45Q218.27 -38.55 216.01 -40.16Q213.75 -41.77 210.12 -41.77Q207.85 -41.77 205.58 -40.94Q203.31 -40.11 201.86 -38.01Q200.4 -35.91 200.46 -32.06L186.65 -33.08Q186.51 -39.27 188.6 -43.35Q190.69 -47.44 194.29 -49.77Q197.88 -52.09 202.16 -53.09Q206.43 -54.08 210.67 -54.08Q218.37 -54.08 223.41 -51.2Q228.45 -48.33 230.92 -42.88Q233.39 -37.43 233.39 -29.63V-20.19Q233.39 -16.84 233.4 -13.44Q233.4 -10.05 233.4 -6.7Q233.41 -3.35 233.41 0H219.95Q219.99 -3.69 220.01 -7.46Q220.04 -11.22 220.07 -15.39H219.45Q219.01 -10.79 216.45 -6.98Q213.88 -3.17 209.71 -0.89Q205.55 1.39 200.12 1.39ZM206.4 -9.98Q208.24 -9.98 210.29 -10.69Q212.35 -11.41 214.16 -13.01Q215.98 -14.61 217.12 -17.35Q218.26 -20.09 218.27 -24.05L218.28 -26.43L220.97 -26.79Q220.14 -25.46 218.23 -24.66Q216.31 -23.85 213.92 -23.4Q211.53 -22.95 209.09 -22.49Q206.65 -22.03 204.57 -21.24Q202.49 -20.46 201.2 -19.14Q199.9 -17.83 199.9 -15.51Q199.9 -12.83 201.78 -11.4Q203.66 -9.98 206.4 -9.98Z M238.21 0V-28.67L238.19 -52.68H251.37L251.23 -30.89H252.04Q252.74 -39.35 254.79 -44.42Q256.85 -49.49 260.31 -51.78Q263.77 -54.08 268.61 -54.08Q273.63 -54.08 276.74 -51.59Q279.85 -49.11 281.33 -43.99Q282.81 -38.87 282.66 -30.89H283.47Q284.16 -39.25 286.35 -44.32Q288.54 -49.39 292.15 -51.73Q295.76 -54.08 300.71 -54.08Q304.81 -54.08 307.81 -52.58Q310.81 -51.08 312.85 -48.08Q314.9 -45.07 315.9 -40.52Q316.9 -35.97 316.9 -29.86V0H301.4V-28.47Q301.4 -32.49 300.72 -35.16Q300.04 -37.84 298.67 -39.15Q297.3 -40.45 295.18 -40.45Q292.39 -40.45 290.1 -38Q287.81 -35.54 286.44 -30.68Q285.07 -25.83 285.07 -18.47V0H269.95V-28.89Q269.95 -32.87 269.26 -35.4Q268.58 -37.93 267.17 -39.19Q265.75 -40.45 263.64 -40.45Q260.97 -40.45 258.72 -38.28Q256.48 -36.11 255.09 -31.26Q253.71 -26.4 253.71 -18.47V0Z"/><path fill="#DB2D55" d="M45.76 -56.75Q41.33 -56.75 38.97 -58.63Q36.62 -60.51 36.62 -64.07Q36.62 -67.73 38.98 -69.61Q41.33 -71.49 45.76 -71.49Q50.28 -71.49 52.63 -69.56Q54.99 -67.64 54.99 -64.07Q54.99 -60.6 52.63 -58.67Q50.28 -56.75 45.76 -56.75Z M173.01 -56.75Q168.58 -56.75 166.23 -58.63Q163.87 -60.51 163.87 -64.07Q163.87 -67.73 166.23 -69.61Q168.59 -71.49 173.01 -71.49Q177.53 -71.49 179.89 -69.56Q182.24 -67.64 182.24 -64.07Q182.24 -60.6 179.89 -58.67Q177.53 -56.75 173.01 -56.75Z"/></g></svg></span>`;

// Colours, card and button follow the hosted app's welcome card; nothing here loads from anywhere.
function renderPage(title: string, body: string, head = ""): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <meta name="referrer" content="no-referrer" />
    <title>${title}</title>
    ${head}
    <style>
      :root {
        --bg: #f3f3f3;
        --dot: rgba(24, 24, 27, 0.14);
        --card: #ffffff;
        --ink: #18181b;
        --muted: #71717b;
        --line: rgba(24, 24, 27, 0.08);
        --input: #d4d4d8;
        --primary: #1b4ed8;
        --shadow: 0 1px 2px rgba(0, 0, 0, 0.05), 0 8px 24px -10px rgba(0, 0, 0, 0.16);
        color-scheme: light dark;
        font-family: -apple-system, BlinkMacSystemFont, "Inter Variable", "Segoe UI", system-ui, sans-serif;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --bg: #0c0c0c;
          --dot: rgba(245, 245, 245, 0.16);
          --card: #111111;
          --ink: #f5f5f5;
          --muted: #a1a1a1;
          --line: rgba(245, 245, 245, 0.1);
          --input: rgba(255, 255, 255, 0.11);
          --primary: #346bf1;
          --shadow: 0 1px 2px rgba(0, 0, 0, 0.4), 0 10px 28px -10px rgba(0, 0, 0, 0.7);
        }
      }
      * { box-sizing: border-box; }
      body {
        min-height: 100vh;
        margin: 0;
        display: flex;
        padding: 48px 16px 32px;
        background: var(--bg) radial-gradient(var(--dot) 1px, transparent 1px) 0 0 / 24px 24px;
        color: var(--ink);
        -webkit-font-smoothing: antialiased;
      }
      main {
        width: 100%;
        max-width: 512px;
        margin: 0 auto auto;
        border: 1px solid var(--line);
        border-radius: 10px;
        background: var(--card);
        padding: 20px;
        box-shadow: var(--shadow);
        overflow-wrap: anywhere;
      }
      @media (min-width: 640px) {
        body { padding: 64px 16px 40px; }
        main { margin: auto; padding: 32px; }
      }
      .brand { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
      .mark { width: 28px; height: 28px; flex: none; }
      .word { height: 20px; width: auto; flex: none; }
      h1 { margin: 0; font-size: 20px; line-height: 1.25; font-weight: 600; letter-spacing: -0.025em; }
      p.description { margin: 8px 0 0; color: var(--muted); font-size: 14px; line-height: 1.45; }
      p.fine { margin: 16px 0 0; color: var(--muted); font-size: 12px; line-height: 1.4; }
      a.button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        height: 40px;
        margin-top: 24px;
        border: 1px solid var(--primary);
        border-radius: 8px;
        background: var(--primary);
        color: #fff;
        padding: 0 14px;
        font-size: 14px;
        font-weight: 500;
        text-decoration: none;
      }
      a.button.quiet { border-color: var(--input); background: transparent; color: var(--ink); }
      a.button:hover { opacity: 0.9; }
      a.button:focus-visible { outline: 2px solid var(--primary); outline-offset: 2px; }
      @media (min-width: 640px) {
        h1 { font-size: 24px; }
      }
      @media (max-width: 639px) {
        a.button { display: flex; }
      }
    </style>
  </head>
  <body>
    <main>
      ${WORDMARK}
      ${body}
    </main>
  </body>
</html>`;
}
