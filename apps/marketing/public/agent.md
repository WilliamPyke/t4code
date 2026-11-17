# Connect this computer to Tinkjam

You are a coding agent (Claude Code, Codex or similar) and the person you work for asked you to connect this computer to their Tinkjam account. Tinkjam is a shared board where a team works beside their AI agents: https://trellium.org

Connecting runs Tinkjam Sync, a small helper that lets the person's boards use the agents installed on this computer, under their own sign-in. Nothing anyone else writes on a board reaches an agent here unless this person presses Send.

## Steps

1. Check Node.js: run `node --version`. It must be 22.16 or newer. If it is older or missing, stop and tell the person to install the current version from https://nodejs.org. Do not install it yourself unless they ask.

2. Start Tinkjam Sync as a background process that keeps running, and capture its output:

   ```
   npx -y https://trellium.org/sync.tgz
   ```

   It does not exit by itself. Do not wait for it to finish, and do not run it a second time if it is already running.

3. Within a few seconds it prints a link that starts with `http://127.0.0.1:`. Give that exact link to the person and ask them to open it in their browser, sign in if asked, and press **Connect**. Only they can approve this; do not open or approve it for them.

4. Wait until the output says **Connected**. If the computer was connected before, it says so straight away and prints no link.

5. Tell the person, in a few plain sentences:
   - This computer is connected. On any board at https://app.trellium.org they can press **Bring your agent** and pick this computer.
   - Tinkjam Sync runs as long as this session keeps it running. If they close this session, they can ask you again or run the command in a terminal themselves.
   - To stop it, end the background process. To remove this computer from their account, run `npx -y https://trellium.org/sync.tgz --disconnect`.

## If something goes wrong

- The command fails to download: check the network, then try once more.
- No link and no "Connected" after a minute: show the person the output as it is.
- The port is in use: Tinkjam Sync is probably running already on this computer. Tell the person and leave the running one alone.

Never print or store tokens, and do not change the person's shell profile, startup items or system settings to keep Tinkjam Sync running unless they ask for that.
