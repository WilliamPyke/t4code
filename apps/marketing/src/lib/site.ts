export const SITE_NAME = "Tinkjam";
export const APP_URL = "https://app.trellium.org/";
// The public sample board's view link, as infra/boards/scripts/sample-board.mjs prints it. Empty
// hides "See a sample board". Keep it the same as SAMPLE_BOARD_URL in apps/web/src/sampleBoard.ts.
export const SAMPLE_BOARD_URL: string =
  "https://app.trellium.org/guest?host=boards.trellium.org#c183a660-86b0-43c7-8cdb-8d1b6bd5e531.v.ZTzphbdwzg6agWSGaZeAxnpmkejNwSIY7s98JrXPYoI";
// Tinkjam Sync's package is served beside this site; the app shows the same command.
export const SYNC_COMMAND = "npx -y https://trellium.org/sync.tgz";
export const AGENT_PROMPT =
  "Connect this computer to my Tinkjam account. Read https://trellium.org/agent.md and follow it.";
// Tinkjam is a fork of T3 Code, which is MIT licensed; the footer credits it.
export const UPSTREAM_REPO_URL = "https://github.com/pingdotgg/t3code";
