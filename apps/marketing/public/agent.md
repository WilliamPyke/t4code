# Connect this computer to Tinkjam

You are a coding agent (Claude Code, Codex or similar). The person you work for asked you to connect this computer to their Tinkjam account. Tinkjam is a shared board where a team works beside their AI agents: https://trellium.org

You will run one command. It sets up Tinkjam Sync, a small helper that lets the person's boards use the agents on this computer under their own sign-in, and keeps it running in the background, starting again whenever they log in. Nothing anyone else writes on a board reaches an agent here unless this person presses Send.

Assume the person is not technical. They may never have opened a terminal and do not know what a sandbox is. Your job is to do this for them: they should only have to say yes once and press one button in their browser. Use plain words, never ask them to run a command unless every route below has failed, and tell them exactly what to click when you need something.

## 1. Get permission once, then do it yourself

The command below needs things a sandboxed session usually blocks: downloading from trellium.org, registry.npmjs.org and github.com, writing to `~/.tinkjam` and npm's cache, adding a login item (macOS: a LaunchAgent via `launchctl`; Linux: a systemd user unit; Windows: an entry in the current user's startup apps), and starting a background process that outlives this session.

The person's prompt already says you have their permission to run this command outside your sandbox. So:

- If your harness lets you request elevated, unsandboxed or "full access" execution for a single command, request it for the command in step 3 straight away, in one request, with a one-line reason such as "Connect this computer to Tinkjam". Do not try it sandboxed first.
- If your harness needs the person to change a setting first, ask for that one thing in plain words and wait. For example, in the Codex app: "Click the permissions button under the message box, choose **Full access**, then tell me to continue." In Claude Code: "I will ask to run one command. Choose **Yes**." You can suggest they switch it back afterwards.
- Ask once, for everything together. Never ask piecemeal, and never ask about folders or network hosts one at a time.

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

## 4. If it is still blocked

Do these in order, and stop at the first that works. Do not invent other workarounds: no custom npm cache folders, no hand-written login items, scripts or `.command` files.

1. **Ask for full access and try again yourself**, as in step 1, if you have not already been given it. This is the normal fix. One retry.
2. **Open a terminal for them with the command already running**, so they only watch:
   - macOS: `osascript -e 'tell application "Terminal" to do script "npx -y https://trellium.org/sync.tgz --install"' -e 'tell application "Terminal" to activate'`
   - Windows: `Start-Process powershell -ArgumentList '-NoExit','-Command','npx -y https://trellium.org/sync.tgz --install'`
   - Linux: only if you know which terminal app they use.
     Tell them: "A window opened and is setting it up. If it shows a link, open it and press Connect. You can close the window when it says Tinkjam Sync is running in the background."
3. **Only if both failed**, give them the one line to paste, with the clicks to get there (macOS: press Cmd+Space, type Terminal, press Return; Windows: press the Windows key, type PowerShell, press Enter), and say in one sentence that this session is not allowed to do it for them:

```
npx -y https://trellium.org/sync.tgz --install
```

Afterwards, check that it worked with `npx -y https://trellium.org/sync.tgz --status` if you are able to, and tell them the result.

## 5. Tell the person

In a few plain sentences:

- This computer is connected. On any board at https://app.trellium.org they can press **Bring your agent** and pick this computer.
- Tinkjam Sync runs in the background and starts by itself when they log in. No window needs to stay open.
- To stop it starting by itself: `npx -y https://trellium.org/sync.tgz --uninstall`. To remove this computer from their account: `npx -y https://trellium.org/sync.tgz --disconnect`.

Never print or store tokens, and change nothing else on this computer.
