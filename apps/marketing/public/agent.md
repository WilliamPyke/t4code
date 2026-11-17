# Connect this computer to Tinkjam

You are a coding agent (Claude Code, Codex or similar). The person you work for asked you to connect this computer to their Tinkjam account. Tinkjam is a shared board where a team works beside their AI agents: https://trellium.org

You will run one command. It sets up Tinkjam Sync, a small helper that lets the person's boards use the agents on this computer under their own sign-in, and keeps it running in the background, starting again whenever they log in. Nothing anyone else writes on a board reaches an agent here unless this person presses Send.

## 1. Ask for permission once

If you run in a sandbox or ask before running commands, ask the person once, for everything below together, before you start. Do not ask piecemeal.

- Network access to trellium.org and its subdomains, registry.npmjs.org, and github.com (a one-time download).
- Write access to `~/.tinkjam` and to npm's cache (`~/.npm`, or `%LocalAppData%\npm-cache` on Windows).
- Permission to add a login item and start a long-running background process: on macOS a LaunchAgent in `~/Library/LaunchAgents` (via `launchctl`), on Linux a systemd user unit in `~/.config/systemd/user` (or `~/.config/autostart`), on Windows an entry in the current user's startup apps (`HKCU\...\Run`).

If your harness can run a command outside its sandbox or with full permissions, ask to run this one command that way. That is the simplest single approval.

## 2. Check Node.js

Run `node --version`. It must be 22.16 or newer. If it is older or missing, stop and tell the person to install the current version from https://nodejs.org. Do not install it yourself unless they ask.

## 3. Run the command

```
npx -y https://trellium.org/sync.tgz --install
```

- If this computer is not connected yet, it prints a link that starts with `http://127.0.0.1:` and waits. Give that exact link to the person and ask them to open it, sign in if asked, and press **Connect**. Only they can approve it; never open or approve it for them.
- It then starts Tinkjam Sync in the background and exits by itself. The last line says `Tinkjam Sync is running in the background and will start when you log in.` It takes up to a few minutes; let it finish.
- If it prints that a newer Tinkjam Sync is out, run the command it shows instead.

## If Tinkjam Sync is already on this computer: updating and fixing

The same command does all of it. Running `--install` again is safe: it replaces the installed copy with the newest one, repairs the login item, restarts the background service, and keeps the account connection, so it asks for **Connect** again only if this computer is no longer connected. Use it when the person says Tinkjam Sync is out of date, their computer shows as offline on a board, agents do not start, or Node.js was reinstalled or moved.

1. To see where things stand first, run `npx -y https://trellium.org/sync.tgz --status`. It says whether Sync runs in the background and where its log is.
2. Run `npx -y https://trellium.org/sync.tgz --install` and let it finish.
3. If it still does not say it is running, read the last 30 lines of the log file `--status` named and tell the person what it says, leaving out anything that looks like a token or a link with a code in it. Do not edit files in `~/.tinkjam` by hand.
4. Only if the person asks to start over: `--uninstall`, then `--install`. To move the computer to a different Tinkjam account: `--disconnect`, then `--install`.

## 4. If it is blocked: stop, do not improvise

If your sandbox still blocks the command after one attempt with the permissions above (a download, a folder, `launchctl`, a process check, or anything else), do not work around it. No custom npm cache folders, no hand-written login items, scripts or `.command` files, no second attempts with different flags. Tell the person, in one or two sentences, that this session's sandbox blocks it, and ask them to paste this one line into Terminal (macOS, Linux) or PowerShell (Windows):

```
npx -y https://trellium.org/sync.tgz --install
```

It connects the computer and sets everything up the same way; they can close the window when it says it is running in the background.

## 5. Tell the person

In a few plain sentences:

- This computer is connected. On any board at https://app.trellium.org they can press **Bring your agent** and pick this computer.
- Tinkjam Sync runs in the background and starts by itself when they log in. No window needs to stay open.
- To stop it starting by itself: `npx -y https://trellium.org/sync.tgz --uninstall`. To remove this computer from their account: `npx -y https://trellium.org/sync.tgz --disconnect`.

Never print or store tokens, and change nothing else on this computer.
