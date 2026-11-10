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
   back to the thread.
3. When a guest sends a message, it appears at the end of the thread under their name and the
   sidebar shows **Request**. Choose **Send** to run it as a normal turn, or **Dismiss**. Files they
   attached show with the message, and **Send** includes them. The agent is told which guest wrote
   each message you send.

The thread header names who has joined. On web, click the names to see who has the thread open
right now.

Choose **Stop sharing** to end the link for everyone at once. Archiving the thread, creating a new
link, or unlinking the machine from T3 Connect also ends it. You can send or dismiss guest messages
from the mobile app.

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
on your first message. It is a one-time copy: it does not update when the owner's thread moves on,
and nothing you do in it goes back. Your turns run on your machine, with your own provider login,
model, and permission mode, so this works on a Claude or ChatGPT plan. Share code back the usual
way, with a branch or a pull request.

The copy holds the messages you could see when you chose it, up to the most recent 400. Images and
other files in them stay behind. The link T3 Code opens is good for 10 minutes; choose **Continue
on my machine** again if it runs out. This works on desktop and web, not yet in the mobile app.

## What a guest sees

A guest sees the thread's recent history and everything after, in the same timeline you see, as
it streams: messages and their files, the agent's replies with the images they show from your
machine, its reasoning, plans, questions, and its work, with command output when they expand a
command. Their composer shows the thread's model, but they cannot change it. They do not see diffs, and they cannot act on the thread: no forking,
reverting, opening files on your machine, or answering the agent for you.

Guests also see each other's names, who is away, and the messages each of them has waiting.

Anything the agent read or printed can show, such as a value from a file, and a guest can
[take a copy of the conversation](#continue-on-your-own-machine) that stays with them after you stop
sharing. Share only threads you are comfortable showing.

## Guest attachments

Guests can attach images and other files to a message: use the paperclip, paste, or drop them on
the message box. A message holds up to 4 files and 10 MB in total. Images must be PNG, JPEG, GIF, or
WebP. Each guest can have 3 messages waiting for you, and the files of all waiting messages can
total 20 MB; guests can send more once you send or dismiss some.

Dismissing a message, ending the link, or archiving the thread deletes the files of messages that
still wait. A sent message keeps its files, like any message in the thread.

The guest's text and files run with the thread's current permission mode once you send them. Check
them before you choose **Send**, as you would anything pasted from a chat.
