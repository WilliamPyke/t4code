# Install Tinkjam Sync on this computer

You are a coding agent (Claude Code, Codex or similar). The person you work for asked you to install Tinkjam Sync. Tinkjam is a shared board where a team works beside their AI agents (https://tinkjam.com). Tinkjam Sync is a small app that connects this computer to their Tinkjam account so their boards can use the agents on it. It sits in the menu bar (Mac) or system tray (Windows), starts with the computer and updates itself. Nothing anyone else writes on a board reaches an agent here unless this person presses Send.

Assume the person is not technical. They may never have opened a terminal. Do this for them: they should only have to say yes once and press one button in their browser. Never leave Tinkjam Sync running inside your own session or terminal: it must end up as the installed app.

## 1. Run one install command

The person's prompt already gives you permission to run this outside your sandbox. It needs network access to tinkjam.com, trellium.org, nodejs.org and registry.npmjs.org, and it writes the app to the Applications folder and its data to `~/.tinkjam`. If your harness lets you request unsandboxed or "full access" execution for one command, request it for this command straight away, once, with a one-line reason such as "Install Tinkjam Sync". If the person must change a setting first, ask for that one thing in plain words (in the Codex app: "Click the permissions button under the message box, choose Full access, then tell me to continue").

macOS:

```
curl -fsSL https://tinkjam.com/downloads/install.sh | sh
```

Windows (PowerShell):

```
powershell -ExecutionPolicy Bypass -c "irm https://tinkjam.com/downloads/install.ps1 | iex"
```

Linux (no app yet; this needs Node.js 22.16 or newer and installs a background service instead):

```
npx -y https://tinkjam.com/sync.tgz --install
```

Each of these downloads Tinkjam Sync, checks its checksum, installs it for this user only (no administrator password), replaces any older copy or older background service, and opens it. Running it again later updates or repairs it.

## 2. Hand over for one click

The app opens the person's browser by itself. Tell them: "Tinkjam Sync opened a page in your browser. Sign in and press Connect." Only they can approve; never open or approve the link for them. If this computer was connected before, nothing is asked.

## 3. If the command is blocked

Do these in order and stop at the first that works. Do not invent other workarounds, and do not fall back to running Sync from your own terminal.

1. Ask for full access as in step 1 and try once more.
2. Give them the download instead: "Download Tinkjam Sync from https://tinkjam.com/#agents, open the file, and press Connect when your browser opens." On a Mac, give this instead: "Open the Terminal app, paste `curl -fsSL https://tinkjam.com/downloads/install.sh | sh` and press Return." Do not send a Mac user to a download: macOS blocks it. Say in one sentence that this session is not allowed to install apps.

## 4. Tell the person

In two or three plain sentences: Tinkjam Sync is installed and shows in their menu bar or system tray; on any board at https://app.tinkjam.com they can press **Bring my agent** and pick this computer; to stop it they choose Quit from its menu, and to remove this computer from their account they choose Disconnect there.

## Updating and fixing

Run the same install command again. It replaces the app with the newest one and keeps the account connection. If the app is open but says it is not connected or stopped, tell the person what its menu says (the first line is the status) rather than guessing; "Show log" in its menu opens the details. Do not edit files in `~/.tinkjam` by hand, and never print tokens.
