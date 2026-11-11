# Guest links

A guest link lets up to 8 teammates follow one thread in their browsers and ask the agent questions,
with no account. They see your messages and the agent's replies as they stream. Each message they
send waits until you send or dismiss it, unless you let a guest
[send without asking](#let-a-guest-send-without-asking).

## Share a thread

Guest links are a beta. Turn on **Settings → Labs → Guest links** for the machine that runs the
thread. They also need [T3 Connect](./remote-access.md): sign in and link that machine, because the
link points at its T3 Connect address. The machine must stay online while the guest uses it.
While the setting is off, every guest link on that machine stops working; links that have not
expired work again when you turn it back on.

1. Right-click the thread in the sidebar and choose **Share with guests**. It is also in the thread
   menu and the command palette.
2. Copy the link and send it to the people you want in the thread. Anyone who has the link can join
   until 8 people have, so send it only to them. It expires after 24 hours. Each person picks a
   name no one else on the link uses, and opening the link again in the same browser takes them
   back to the thread. The link opens in the hosted T3 Code app when your server is
   [set up for one](#where-the-link-opens), and on your machine's T3 Connect address otherwise.
3. When a guest sends a message, it appears at the end of the thread under their name and the
   sidebar shows **Request**. Choose **Send** to run it as a normal turn, or **Dismiss**. Files they
   attached show with the message, and **Send** includes them. The agent is told which guest wrote
   each message you send.

The thread header names who has joined. On web, click the names to see who has the thread open
right now.

To invite someone later, choose **Share with guests** again and **Show link**: it is the same link.

Choose **Stop sharing** to end the link for everyone at once. Archiving the thread, choosing
**Replace link**, or unlinking the machine from T3 Connect also ends it. You can send or dismiss guest messages
from the mobile app.

## See the room as a board

On web, choose **Board** in a shared thread's header. The thread and each guest appear as cards
you can drag, with what each guest has waiting for you, and you can add notes. Scroll to move,
and hold Ctrl or Cmd while scrolling to zoom.

The board belongs to the room. Guests open the same one with **Board** in the thread's header, and
everyone sees a card land where it was dropped and a note once its author clicks away from it.
Anyone in the room can move, edit or delete any note; each note names who added it. A board
holds up to 50 notes of 280 characters. Agents never see the board, so use a message, not a note,
for anything an agent should act on.

The board lasts as long as the link: stopping sharing or creating a new link starts an empty
one, and removing a guest removes their notes. Someone who continued the thread on their own
machine does not get the board in their T3 Code; they still see it in the shared thread.

## Remove a guest

On web, click the guest names in the thread header and choose **Remove** under the guest. They lose
access at once and the messages they had waiting are deleted. Guests have no account, so the link
also stops letting new people in; otherwise the same person could join again under another name.
Everyone else stays. To invite someone after that, create a new link and send it to all of them.

## Let a guest send without asking

On web, click the guest names in the thread header and turn on **Send without asking** for a guest
you trust. Their messages then go to the agent as soon as they send them, queued behind any turn
that is running, and the agent is told you did not read them first. Turn it off to go back to
approving each one.

This works only while the thread's provider is Claude or Codex signed in with an API key. Claude
and ChatGPT plans cover your own prompts, not someone else's, so on a plan sign-in every guest
message still waits for you. Other providers always wait.

A trusted guest's message runs with the thread's current permission mode before you see it. In
full access that lets them have the agent run anything on your machine, so trust only people you
would hand your terminal to, and prefer a mode that asks before acting. Their usage is billed to
your key.

### Approve contributors once

A typed name proves nothing, so the switch above is per guest and per link. To approve someone
for every link, list their GitHub username under **Settings → Labs → Guest links → Approved
contributors**. When they join a link and choose **Sign in with GitHub** in the shared thread, their
browser goes to GitHub and comes back, and from then on their messages are sent without asking on
that thread. You can also approve a signed-in guest from the guest names in the thread header.

The first sign-in ties the username to that GitHub account, so someone who takes the username later
is not approved. Removing a username applies to links that person joins afterwards; turn off
**Send without asking** on a thread to stop them there now. The same API key rule applies.

The shared thread offers the sign-in only when the server that runs the thread was started with a
GitHub app's client ID in `T3CODE_GITHUB_APP_CLIENT_ID` and its client secret in
`T3CODE_GITHUB_APP_CLIENT_SECRET`. The app must list
`https://<your T3 Connect host>/api/guest/sign-in/callback` as a callback URL. T3 Code asks GitHub
for no permissions, reads the guest's username and account number, then discards the token.

## Continue on your own machine

A guest who has T3 Code can take the thread to their own machine. On the shared thread's page,
choose **Continue on my machine**. It opens T3 Code, which asks before it contacts the owner's
machine, then shows what comes over and offers:

- **Join with the code**, when you have the same repository on a connected machine. Your thread
  starts in a new worktree from the owner's branch, as its remote has it, and your setup script
  runs on it. T3 Code tells you when the owner has work that is not pushed yet, because you will
  not get that work.
- **Conversation only**, which starts a thread without a project.

You get your own thread with the conversation as its history, and the agent is handed that history
on your first message. Your turns run on your machine, with your own provider login, model, and
permission mode, so this works on a Claude or ChatGPT plan. Share code back the usual way, with a
branch or a pull request.

### Your turns show in the room

The thread stays connected to the room it came from. Each time a turn finishes in it, T3 Code
sends the prompt and your agent's final reply to the owner's machine, which shows them to the owner
and every guest as your agent's, for example **Sam's agent**. T3 Code tells you this before you
join, and the thread header says **Your turns show in the room** while it is on. Choose **Leave
room** there to stop; your thread keeps working as a plain copy, and what the room already shows
stays until the owner stops sharing.

Only that text goes back: no files, command output, reasoning, or diffs. A long prompt or reply is
shortened, and the room keeps the 10 most recent turns from all guests. A turn you interrupt, or
one that fails, is not sent. The connection ends on its own when the link expires, the owner stops
sharing, or the owner removes you.

For the owner: a guest's turn is only shown. It never starts a turn on your thread and your agent
never receives it, so nothing a guest runs is billed to you or counted as your prompt. To act on
it, write your own message. Removing a guest also removes the turns they posted.

### Catch up on the room

Your thread does not update by itself when the owner's thread or other guests move on. Choose
**Catch up** in the thread header, or above the composer in the mobile app, to bring over what the
room said since you joined or last caught up: the owner's messages, their agent's final replies,
guest messages the owner sent, and other guests' own turns. Your own turns are left out. A reply
from the owner's agent comes over once its turn has ended, so a turn still running when you catch
up arrives with the next one.

Nothing runs when you catch up. The updates appear as a **Room updates** chip in your next message;
open it to read them, remove it if you do not want them, and send the message yourself. Your agent
reads them as what other people and their agents said, not as your instructions, so say in your
message what you want done with them. Removing the chip does not bring those updates back on the
next catch-up; the shared page still shows them.

One catch-up brings at most the 50 most recent updates, as text only, and shortens long ones; the
chip says when something was cut. If the room has ended or the owner removed you, the header stops
saying you are in it.

The copy holds the messages you could see when you chose it, up to the most recent 400. Images and
other files in them stay behind. The link T3 Code opens is good for 10 minutes; choose **Continue
on my machine** again if it runs out. Joining works on desktop and web, not yet in the mobile app.
A thread you already joined shows **Catch up** and **Leave room** above the composer there; the
mobile app does not show guests' own turns.

## What a guest sees

A guest gets T3 Code in their browser with the thread in the sidebar, under **Shared with me**. To
put your name over your threads there, set **Settings → Labs → Guest links → Name shown to
guests**; a guest sees a new name the next time they open the thread. Threads from other links they joined in that browser
are listed there too, and someone who uses T3 Code with their own machines sees shared threads
beside their own. A shared thread is listed for as long as its link lasts.

A guest sees the thread's recent history and everything after, in the same timeline you see, as
it streams: messages and their files, the agent's replies with the images they show from your
machine, its reasoning, plans, questions, and its work, with command output when they expand a
command. Their composer shows the thread's model, but they cannot change it. They do not see
diffs, and they cannot act on the thread: no forking, reverting, opening files on your machine,
stopping a turn, or answering the agent for you. Nothing else on your machine is listed for them:
no other thread, project, terminal, or setting.

Guests also see each other's names, who is away, the messages each of them has waiting, and the
turns guests [ran on their own machines](#your-turns-show-in-the-room).

Anything the agent read or printed can show, such as a value from a file, and a guest can
[take a copy of the conversation](#continue-on-your-own-machine) that stays with them after you stop
sharing. Share only threads you are comfortable showing.

### Where the link opens

A guest link normally opens on your machine's T3 Connect address. If you run a hosted copy of the
T3 Code web app, start the server with its address in `T3CODE_HOSTED_APP_URL` (for example
`https://app.example.org`) and new links open there instead, naming your machine:
`https://app.example.org/guest?host=<your T3 Connect host>#<invite>`.

With a hosted app, the link you copy is a short readable one, such as
`https://app.example.org/r/tulip-otter-harbor`. T3 Connect keeps what the name stands for until the
link expires, and the hosted app looks it up. The name is the key to the thread, so treat it like
the full link.

The hosted app follows a link only to a machine in its own T3 Connect domain: with the app at
`app.example.org`, that is `<name>.example.org`. Build the hosted app with `VITE_GUEST_HOST_ZONE`
set to the domain if your machines' addresses are somewhere else. A link that names any other
host is refused before anything is sent to it.

The guest's browser keeps a token for each thread it joined, in the hosted app's storage. The
token lasts as long as the link, reads that one thread, and sends messages for you to approve;
it does not sign in to your machine.

## Guest attachments

Guests can attach images and other files to a message: use the paperclip, paste, or drop them on
the message box. A message holds up to 4 files and 10 MB in total. Images must be PNG, JPEG, GIF, or
WebP. Each guest can have 3 messages waiting for you, and the files of all waiting messages can
total 20 MB; guests can send more once you send or dismiss some.

Dismissing a message, ending the link, or archiving the thread deletes the files of messages that
still wait. A sent message keeps its files, like any message in the thread.

The guest's text and files run with the thread's current permission mode once you send them. Check
them before you choose **Send**, as you would anything pasted from a chat.
