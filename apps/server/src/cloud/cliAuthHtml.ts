/** The page the browser lands on once it approved this computer; the terminal says the rest. */
export function renderLoopbackAuthorizationCompleteHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <title>Connected to Tinkjam</title>
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
    </style>
  </head>
  <body>
    <main>
      <p class="brand">Tinkjam</p>
      <h1>This computer is connected</h1>
      <p class="description">You can close this window. Keep the terminal running while you work.</p>
    </main>
  </body>
</html>`;
}
