export const SITE_NAME = "Tinkjam";
export const APP_URL = "https://app.trellium.org/";
// The public sample board's view link, as infra/boards/scripts/sample-board.mjs prints it. Empty
// hides "See a sample board". Keep it the same as SAMPLE_BOARD_URL in apps/web/src/sampleBoard.ts.
export const SAMPLE_BOARD_URL: string =
  "https://app.trellium.org/guest?host=boards.trellium.org#1ecbf7b4-8fc3-46f8-8a5c-8a683e311029.v.usrcvSaVH6bFGp3ACk5tGWNPWwFWYCZ5eXYLRB7usFE";
// Tinkjam Sync's package is served beside this site; the app shows the same command.
export const SYNC_COMMAND = "npx -y https://trellium.org/sync.tgz --install";
export const AGENT_PROMPT =
  "Connect this computer to my Tinkjam account. Read https://trellium.org/agent.md and do it for me. You have my permission to run its setup command outside your sandbox.";
// Tinkjam is a fork of T3 Code, which is MIT licensed; the footer credits it.
export const UPSTREAM_REPO_URL = "https://github.com/pingdotgg/t3code";
