# Guest links

A guest link lets up to 8 teammates follow one thread in their browsers and ask the agent questions,
with no account, and work with you on the thread's [board](#see-the-room-as-a-board), which you can
also use on your own before you share. For people you work with every day, share with a [team](./teams.md) instead. They see your messages and the agent's replies as they stream. Each message they
send waits until you send or dismiss it, unless you let a guest
[send without asking](#let-a-guest-send-without-asking).

## Share a thread

Guest links are a beta. Turn on **Settings → Labs → Guest links** for the machine that runs the
thread. They also need [Tinkjam Connect](./remote-access.md): sign in and link that machine, because the
link points at its Tinkjam Connect address. The machine must stay online while the guest uses it.
While the setting is off, every guest link on that machine stops working; links that have not
expired work again when you turn it back on.

1. Right-click the thread in the sidebar and choose **Share with guests**. It is also in the thread
   menu and the command palette.
2. Choose how long the link lasts: 1 day, 7 days or 30 days. Copy the link and send it to the
   people you want in the thread. Anyone who has the link can join until 8 people have, so send it
   only to them. Each person picks a
   name no one else on the link uses, and opening the link again in the same browser takes them
   back to the thread. The link opens in the hosted Tinkjam app when your server is
   [set up for one](#where-the-link-opens), and on your machine's Tinkjam Connect address otherwise.
3. When a guest sends a message, it appears at the end of the thread under their name and the
   sidebar shows **Request**. Choose **Send** to run it as a normal turn, or **Dismiss**. Files they
   attached show with the message, and **Send** includes them. The agent is told which guest wrote
   each message you send.

The thread header names who has joined. On web, click the names to see who has the thread open
right now.

To invite someone later, choose **Share with guests** again and **Show link**: it is the same link.
The dialog says when the link ends, and asks you to extend it once it has less than 6 hours left. **Extend link**
makes it last 1, 7 or 30 days from now, and everyone on it stays. An extended link is given out
in full: a [short readable link](#where-the-link-opens) you sent earlier still works until the
link's first end, but not after it.

Choose **Stop sharing**, in the thread header or the share dialog, to end the link for everyone at
once. **Replace link** in the dialog ends it too and makes a new one: pick how long the new link
lasts, the first choice being as long as the old one did. Archiving the thread or unlinking the
machine from Tinkjam Connect also ends it. If anyone has joined, Tinkjam asks you to confirm before it
stops sharing or replaces the link. You can send or dismiss guest messages from the mobile app.

## See the room as a board

On web, every thread has a board: choose **Open board** in the thread's menu or the command
palette, or **Board** in a shared thread's header. The board is where the room works: the
thread, each guest, and every [thread box](#thread-boxes) appear as cards you can drag, with what
each guest has waiting for you, and you can add notes.

To start a new board from a layout, open the arrow beside **New board** on Boards, or **New board
from template…** in the command palette: **Plan a feature**, **Bug bash**, **Design review** and
**Retro** come with sections, placeholder notes to fill in and lines into the thread box. **Research
with agents** and **Build with agents** also add named thread boxes and an artifact; their boxes
start empty and use your default model unless you pick another. **Blank** is the default,
and **New board** itself still makes a blank board in one click.

You can plan on a board before inviting anyone. A thread you have not shared opens on an empty
board, kept on the thread from your first change, and its header says **Not shared**. Everything
that needs no guest works there: cards, lines, colours, comment threads, thread boxes running on
your agent, and artifacts. **Share** in the board's header opens the same dialog as **Share with
guests**, to make, extend, replace or stop the link or clear the board. Once shared, the header names who
joined (click the names to manage guests) and has **Stop sharing**. The thread's card says when your agent is
working, and a guest's agent gets a card as soon as it starts a turn
[on their machine](#your-turns-show-in-the-room). Scroll or drag the empty board to move, and
hold Ctrl or Cmd while scrolling, or pinch, to zoom towards the pointer. Double-click the empty
board to add a note there and start writing in it. With a note or task selected, or while writing
in one, Ctrl+Enter (Cmd+Enter on a Mac) or the **+** on its right edge adds the next one beside it
in the same colour, ready to type. Hold Alt (Option on a Mac) as you start dragging notes, tasks or
links to drag copies of them instead, leaving the originals and their lines where they are. A card added from the toolbar is ready to type
in too. A note or task lands in the middle of the view (or the section you selected), just beside
whatever is already there; other cards go where you are working: into the section you selected,
last pointed at, or last added or picked a card in, or else as near the middle of the view as there
is room. Right-click the board, a card or a selection for what you can do there (Shift+F10 or the
Menu key does the same for the selected card). When cards are
small on screen, the buttons on a note's header fold into one **…** menu, so the rest of the
header is free to grab.

Everyone with the board open sees the others' pointers on it, each with its owner's name. Yours
shows only while your pointer is over the board. A card someone is dragging or resizing moves for
everyone as they do it, outlined in their pointer's colour. Click a name on a pointer, or **Follow** on a
guest's card, to see what they see as they move around; panning or zooming yourself, or **Stop
following**, ends it.

Besides notes, add a **Task**, which anyone can tick off and assign to someone in the room, or a
**Link**: type or paste an address, or paste one on the board or into an empty note. A link to a
GitHub pull request, issue or file shows as its repository and number or path, and **Open**
opens it in a new tab; Tinkjam does not load the page. To draw an arrow, drag the dot on a card's
edge onto another card; click an arrow to delete it. Drag a card's bottom corners to resize it;
everyone sees the new size. Press Escape while dragging, resizing or drawing an arrow to put
everything back as it was; nothing is sent. As you drag or resize a card it snaps into line with
the cards near it, to even gaps between them, and to a section's padding, and a thin line shows
what it lines up with. Hold Ctrl (Cmd on a Mac) while dragging to put it exactly where you let go.

A note can be one of six colours: choose the palette on it. Anyone can recolour a note, and your
next notes take the colour you picked last. React to a note, task, link, artifact or thread box
with the smiley on it; reactions show under the card with how many, and clicking one adds or takes
back your own. When the owner removes a guest, that guest's reactions go too.

Click a card to select it, and click the empty board to let go of it. Drag a note or task by its
text to move it; double-click it, press Enter, or just start typing, to write in it. Hold Shift
(or Ctrl, Cmd on a Mac) and click cards to select several, hold Shift and drag across empty board to select everything the rectangle touches,
or press Ctrl+A (Cmd+A on a Mac) to select every card. Dragging a selected card moves the whole
selection; dragging any other card moves just that one and selects it. The arrow keys nudge the
selection a little, or further with Shift. The bar just above a selection also recolours all its
notes at once, and has:

- **Tidy**, which lines the selected cards up in an even grid from where the top-left one was, in
  the order you read them, moving it right or down only as far as it takes to clear other cards.
- **Duplicate** (or Ctrl+D, Cmd+D on a Mac), which copies the selected notes, tasks and links next
  to them as your own cards and selects the copies. Thread boxes, artifacts, code and pull request
  windows, comment threads and sections are not copied, and the board says so. Ctrl+C then Ctrl+V (Cmd on a Mac) does the same, placing the copies at
  your pointer, on this board or another one open in the same browser. Pasting text copied anywhere else makes a note of it, and pasting a link makes a
  link card.
- **Group in a section**, which puts a section around them where they are.

Delete (or Backspace) removes the selected cards you may delete after you confirm; cards that are
someone else's stay, and the board says how many it left. Escape or **Clear** ends the selection.
Only you see what you selected.

A **Section** is a titled frame drawn behind the cards, to group them. Drag it by its title or
anywhere along its edge and the cards sitting mostly inside it move with it, as they do when the
arrow keys move it; drag a card out and it is no longer in it. Dragging inside a section pans the
board, unless the section is selected: then it moves the section. Click its title to rename it.
Resize it from its bottom corners, up to 20,000 pixels a side (other cards go up to 8,000), and
colour it like a note. A section never goes to an agent and takes no
lines. Only whoever added it, or the owner, can rename or delete it. Deleting a section with cards
on it asks whether to keep them where they are or delete them too. Enter or clicking away saves a section's, thread box's or artifact's title;
Escape puts back the one it had.

Ctrl+Z (Cmd+Z on a Mac) undoes your own last change on the board, and Ctrl+Shift+Z or Ctrl+Y
redoes it; the arrows in the toolbar do the same. Undo covers moving and resizing cards, a note's
text and colour, adding a card, and drawing or deleting a line, and takes back a Tidy, Duplicate or
recolouring of several cards in one step. It does not bring back a card you
deleted. If someone else has changed that card since, the undo is skipped and the board says so,
so you never undo another person's work. Undo history lasts while the board is open.

To turn a note into a message, drag it onto the thread's card, which says **Use as message** while
the note is over it, or choose **Use as message** on the note. Its text lands in your message box,
after anything you had written (pressing it twice adds it once), and the note stays where it was
on the board. A card the drop would do nothing for is simply moved there. Nothing is sent until you send it, and a guest's message still waits for the owner. A guest
whose agent has a card on the board can instead drag a note onto **Your agent** or choose **Give
to my agent**: it opens as a draft in their own Tinkjam, as a task does below.

### Thread boxes

A thread box is a conversation of its own on the board. The thread's own card is the owner's
first one; anyone in the room can add more, and each belongs to whoever added it. Write in a box's
message box and press Send. The model the box will use shows beside it, and whoever added the box
can pick another there. The box keeps that model for everyone, after a reload too, until someone
picks another or it runs on another. A box you add starts on the model you last picked for one of
your boxes on that board.

- **The owner's box** runs on the owner's agent. Its first prompt starts a new thread on the
  owner's machine, in the same project, worktree and branch as the shared thread, named after the
  box; it is in the owner's thread list like any other. Later prompts go to that thread, and wait
  behind a turn it is running. The box shows its last few turns.
- **A guest's box** runs on the guest's own agent once they
  [continued on their machine](#continue-on-your-own-machine) and have that machine connected in
  the app they read the board in. Its first prompt starts a thread on their machine beside the
  one they joined with, named after the box, on their own provider login; nothing waits for the
  owner and nothing is billed to them. The model shows beside the box's message box, where they
  can pick another: a new box starts on the model they last picked for one of their boxes there,
  or else on the model of the thread they joined with. The room sees what
  [any turn of theirs shows](#your-turns-show-in-the-room): the prompt, the cards that went with
  it, the model, what the agent is doing, and its reply, on the box and in the artifact it fills.
  **Open conversation** on the box opens that thread.
- **A guest with no machine in the room** still has their box run on the owner's agent. The
  prompt waits for the owner, saying which box (and which artifact) it is for, and runs in that
  box's thread once the owner chooses **Send**, unless the guest may
  [send without asking](#let-a-guest-send-without-asking).

Only the person who added a box can prompt it. The box's message box says where the prompt goes
before you send it.

To bring a thread you already have onto the board, open the toolbar's **Thread** menu and choose
**Add one of your threads**, then pick it. The owner picks from the threads on their machine; a
guest can do this once a machine of theirs is in the room, and picks from that machine's threads.
A thread that is shared itself, or keeps a board of its own, is not listed. The box takes the thread's name and shows its last finished turn. From then on the room sees that
thread the way it sees any box: the start of each prompt, the cards that went with it, the model,
what the agent is doing, and the start of its reply. That includes turns you run in the thread
itself, from its own message box, not only prompts sent from the board. An artifact is filled only
by a prompt sent from the board with a line to it. A thread can be on one board at a time, and a
shared thread, one with a board of its own, or one joined from someone's room cannot be added.

While a box's agent works, everyone sees what it is doing: waiting its turn, thinking, using a
tool, writing its reply, or waiting for whoever runs it to approve something. An artifact a box
fills shows the reply as it is written, a few seconds behind for a box on a guest's machine.
Deleting a box asks first, and its chat stays in your list unless you tick **Also delete the
chat**. If you archive or delete a box's thread, the box's
next prompt starts a new thread for it. A board holds up to 12
thread boxes.

### What your agent can do on the board

The agent in one of the boxes, or in the board's own thread, can read the board it is on and plan
work there. Ask it in plain words, for example:

- "Break this goal into tasks, prioritise them, and put them in the Plan."
- "Read the notes attached to you and turn the open questions into tasks assigned to me."
- "Update the status of the tasks you finished."

It sees every card, which cards are attached to its box, each task's status, priority, due date and
assignee, and who is on the board. It adds notes, tasks and sections in one tidy group next to the
board's tasks or its box, or inside the section you name, and can edit a note's or task's text,
move a task between To do, In progress and Done, set its priority, due date and who it is for, move
cards into a section and draw lines. "Me" means the person whose box it is; it only assigns tasks to
people on the board, and assigning a task only names who it is for: their agent starts nothing
until they press Send. Cards it adds say which agent made them and on which model. They count as the
cards of whoever's box it is: anyone in the room can edit or move them, and the owner and that
person can remove them. It never removes a card, never attaches a card to someone else's agent or
rewrites one attached there, and it only works on the board its own thread is on. It reads cards as
other people's words, not as instructions. A guest whose box runs on their own machine can ask its
agent the same way, on a board someone else shares or a cloud board: it reaches the board through
the link they joined with, so it stops when the link ends or they are removed, and it says so if it
cannot reach the board.

To ask about particular cards, select them and choose **Ask an agent** on the selection bar (under
**More** on a phone), in the right-click menu, or press Alt+A (Option+A on a Mac). Type what you
want, or pick one of the suggestions that fit what you selected, such as **Turn into tasks**, and
choose which of your boxes takes it, or **New thread box** to add one beside the cards. Each box
shows the model it last ran on, and the model picker beside the list sets the model the prompt runs
on, a new box's too. The cards go with that one prompt along lines into the box, as if you had
drawn them, so everyone sees what the agent was given. Escape or clicking away closes it with
nothing changed. It closes as soon as you send; if the prompt cannot be sent, the lines (and a box
added for it) come off again and it opens again with what you typed. A guest's ask follows the same
rules as their box: it may wait for the owner. While an agent adds or changes cards, each one
briefly shows an outline in its box's colour with the box's name.

The box, or the board's thread card, then says what its last turn did, such as "Added 4 tasks and
1 section", with **Show on board** to select those cards. The owner and whoever asked for the turn
can **Undo** everything it did in one step, or press Ctrl+Z (Cmd+Z) when it is the newest thing
they could undo, and **Redo** it. A card someone changed after the agent did stays as it is.

### See every agent at once

**Agents** in the board's header (Alt+G, Option+G on a Mac, or under **More** on a phone) lists
every thread box and the board's own thread: whose it is, its model, what it is doing (such as
"Working · 1m 12s", "Waiting for approval", "Needs you", "Done", "Stopped" or "Failed") and what it
last did to the board. What needs you comes first, then what is working. Click one to go to it. A
guest's prompt waiting for you, or an approval your own agent asks for, can be answered right
there, and the button (or **More** on a phone) shows how many need you. When an agent you asked
finishes, stops, fails or needs you while its box is out of view, a notice says so, with **Show**
to go to it. The minimap outlines the boxes whose agents are working. "Ended" means the run was on
someone else's machine and no reply came back, so the board cannot tell whether it finished.

### Votes and catching up

Point at a note or task and press its **+1** to vote for it, or select cards and press Alt+V
(Option+V on a Mac). Voting again takes your vote back. **Sort by votes**, in a section's menu or
for a selection, lays the cards out with the most voted first.

When you come back to a board, cards other people added or changed since your last visit carry a
small mark, and **N changes since you were here** steps the view through them. Click it for who
did what while you were away, such as "Maya added 4 notes" or "Sam's agent rewrote Onboarding
page"; each line shows its cards. Each browser remembers its own last visit.

### Keys, the command menu and export

The board takes FigJam's keys while you are not typing: N adds a note, T a task, S a section, L draws
a line, V selects, and H (or holding Space) drags the view around. Shift+1 fits everything, Shift+0
zooms to 100%, Ctrl+G groups the selection in a section, and Tab steps through the cards once one is
selected. Press ? for the full list. Ctrl+K (Cmd+K on a Mac) opens the command menu with the board's
own commands first: add cards (paste a link to add it), switch to the Plan, find a card or a person,
export, and **Ask my agent**, which puts what you typed in your agent box for you to send.

The arrow beside the board's name has **Export**: copy or download the board, or its Plan, as
Markdown, or download the board as a PNG image.

### Comment threads

To talk about something on the board, choose **Comment**, click where the comment belongs, write
it and press Enter. It shows as a pin with your initial; click a pin to open its thread, where
anyone in the room can reply (Shift+Enter starts a new line). Everyone sees replies as they land.
A dot on a pin means someone replied since you last opened that thread on this device. Drag a pin
to move it. A thread holds up to 30 replies. To react to a comment or a reply, an agent's too, point
at it and choose the smiley; click a reaction under it to add or take back your own.

When a thread is settled, choose **Resolve**. Resolved threads are hidden: **Resolved** in the
board's toolbar shows them, and **Reopen** brings one back. Anyone can resolve or reopen a thread.
Each person deletes their own replies, and the owner can delete any; only whoever started a thread,
or the owner, deletes the whole thread. A thread whose pin sits on a card, or that has a line to
it, is deleted with the card, and one Undo brings both back.

A thread with a line into a thread box goes with its prompts whole, every comment with who wrote
it; a very long thread sends its first comment and its newest replies. A new comment placed on a
thread box or an artifact gets that line by itself once you write it, unless the board already
holds all the lines it can. Moving a pin later does not change its lines.

To bring an agent into a thread, type your question in the reply field (or leave it empty) and
choose the bot button beside Send, then one of your thread boxes. Your question goes in as your
reply, and that box's agent gets the whole thread and answers it. Its answer lands in the thread
with its formatting, cut to about 1,200 characters, marked with whose agent wrote it and the model,
and everyone in the room sees it,
along with a line while the agent works. You can only ask your own agent: the owner can ask the
room thread's card or any of their boxes; a guest can ask once a machine of theirs joined the room
and they have a thread box of their own there. The person whose agent it was, or the owner, can
delete an answer like any reply. A thread deleted before the answer arrives gets nothing.

### Lines between cards

Lines carry meaning. A note, task, link, comment, comment thread or artifact with a line into a thread box goes
with the next prompt to that box, each with who wrote it, so anyone can steer a box by attaching a
note to it. Once sent, a card stays out of that box's later prompts until it changes: an edited
note or a comment thread with a new reply goes once more. Pin a card (**Always send**) to send it
with every prompt. Anyone can draw a line into a box, but only the box's own person pins a line
into it or sends a card along one again. The box's message lists the cards that will go, each
marked with who changed it since it last went and who connected it, when that was someone else;
remove any you do not want to send, or open **already sent** to send one again. On the board, a sent card's line is dashed and
a pinned one is thicker. A connected note says where it stands: **To send**, **With the agent**
while that prompt's run works, **Sent**, or **Done by agent** once the run finished. A run that
fails or is stopped puts its notes back to **To send**. If the agent did not fix what a done note
asked, the box's person can press **Not fixed, send again** and it goes with their next prompt. A box's
menu, or its artifact's, offers **Remove done notes**. The owner sees the cards
that went
as a **Board** chip on the message, and opening it shows exactly what the agent got. The agent
reads each card as the words of whoever wrote it, so a guest's note is background, not the
owner's instruction. A guest's cards are written into their message's text, so the owner reads
all of it before sending.

A line from a section works as a line from every card in it: draw it from one of the dots on
the section's sides to a thread box (or the artifact a box rewrites) and each card inside goes as above. A card
counts while its middle is inside the section, so dragging one in or out changes what goes. The
box's message shows them as one chip, such as "Research (5 cards)".

A line from a thread box to an artifact means that box's replies fill the artifact.

### Artifacts

An **Artifact** is a card agents write into. Add one, give it a title, and draw a line to it from a
thread box. Each prompt to that box tells its agent that its reply fills the artifact, with what
the artifact shows now to revise. While the turn runs, everyone on the board watches the artifact
being written, about once a second and scrolled to the newest text; a page shows as its source
until it is done, so a half-written page never runs. Once it finishes, the artifact shows the
final reply: markdown as text, or, when the
reply holds a whole HTML page in an `html` code block, the live page. An interrupted or failed
turn leaves the artifact as it was.

To change an artifact without drawing anything, choose **Ask an agent** on the artifact, or select
it (with any cards that should go along) and press Alt+A (Option+A on a Mac). Pick **Rewrite
this**, **Make it shorter** or **Turn into a web page**, or say what to change. The box you choose
gets a line to the artifact if it has none, a box of yours that already writes it is picked first,
and its reply replaces the artifact as above. One ask edits one artifact: with several selected,
the popup names the one it edits, and the others go along as cards. A box with lines to several artifacts fills
the one an ask names, and otherwise the first one it has a line to.

Several boxes can point at one artifact, and the last turn to finish wins. The artifact says which
box wrote it, from which prompt and cards, on which model, and for whom. Each artifact keeps the
version it replaced. The owner, whoever added the artifact, and whoever asked for or whose agent
wrote either version can go back to it with **Restore previous**, and forward again with **Back to
latest**. A board holds up to 6 artifacts, each up to 16,000 characters, and a longer reply is cut.

You can also write an artifact yourself: choose **Edit** on it, or **Write it yourself** while it
is empty, and type Markdown or paste a whole HTML page. It saves when you click away or press
Ctrl+Enter (Cmd+Enter); Esc cancels. Your version replaces it for everyone, and **Restore
previous** brings the old one back.

A guest who [continued on their machine](#continue-on-your-own-machine) can also take an artifact
to their own agent. It opens as a draft in their thread from this room, with the artifact's
current content attached. Nothing runs until they send it; when their turn finishes, its reply
fills the artifact.

### Bring documents in with your agent

Many sources (Linear, GitHub, Notion, Jira, Superhuman, private Google Docs) do not show inside a
link card. To let everyone read one, choose **Bring in with my agent** on its link card, or
**Add and bring in** when you add the link from the toolbar. Tinkjam writes a prompt in one of
your own thread boxes (the one you selected, else the one you used last; with several it asks
which) asking your agent to open the link with the tools you connected to it (a
Linear or Google Drive connection, for example) and write a snapshot of it: for an issue its
status, assignee and latest comments, for a spreadsheet its sheets and first rows, for a design
its pages and frames. Read the prompt, change it if you like, and press **Send**; nothing runs
before that, and only your own agent and your own access are used. Without an agent on the board,
the button offers to bring yours first.

The reply becomes an artifact beside the link card, joined to it by a line, that everyone can
read. It says what it is a snapshot of, whose agent read it and how long ago, with **Open source**
to go to the original. **Refresh** asks your own agent to read it again into the same card; the
previous snapshot stays under **Restore previous**. A snapshot counts toward the board's 6
artifacts. A line from a snapshot, or from its link card, into a thread box sends what the
snapshot says with that box's next prompt; a long one is cut to its start, and the agent is told
so.

### Code windows

A **Code** window shows what a thread box's agent changed: each file with its lines added and
removed, and a file's diff when you click it. Add one from the board's tools and draw a line to it
from a thread box, or choose **New code window** on the box. It updates each time the box's turn
ends; **Last turn only** narrows it to that turn. Everyone in the room sees the file list. A diff
is read from the machine that ran the agent, so the diffs of a guest's box open only on that
guest's own machine. A board holds up to 6 code windows, a window lists up to 50 files, and a very
large file says it is too large to show.

### Pull request windows

A **Pull request** window shows one GitHub pull request, kept current: its title, whether it is
open, a draft, merged or closed, its checks (and which are failing), commits, files and lines
changed, and its branches. Choose **Pull request** in the board's tools and paste its address,
paste a pull request address on the board, or choose **Show pull request** on a thread box whose
thread has one. Only the owner's Tinkjam reads GitHub, with the owner's own sign-in, so guests need
no GitHub access, and a pull request the owner's account cannot see says so. It reads again when
added, when anyone chooses **Refresh**, and every few minutes while someone has the board open.
A board holds up to 10 pull request windows.

### Take a task to your agent

Choose **Take it to my agent** on a task, or drag it onto your own agent's card (the owner's is
the thread's card), to make it yours and put its text in your own message box. For the owner, that is the shared thread, where the
message box says sending it answers the task; dismiss that notice, or clear the draft, and the
message answers nothing. A guest's own Tinkjam opens on the thread they
[continued on their machine](#continue-on-your-own-machine) from this room, joining first if they
have not. Nothing runs until you send it. While a guest's agent works on the task, its card says
so; when that turn finishes, the card shows **Answered by** their agent, or the owner's, with the
start of its reply, and the task is in progress until someone ticks it off. An interrupted or
failed turn leaves the task unanswered, and nobody's turn answers a task someone else has.

### Run tasks with an agent

To hand tasks to agents in one step, select them and choose **Run with an agent** on the
selection bar or in the right-click menu, choose **Run with an agent** on one task, or choose
**Run this section's tasks** in a section's menu. **One box for all** sends them, in order, as one
prompt to one of your thread boxes that is not busy, or to a new one. **A box per task** puts each
in a new thread box of its own beside it, up to 4 at once. The model shown is the one they run on.
A guest's run waits for the owner like any other prompt of theirs, unless it runs on their own
machine.

Each task being run shows its box's name and how it is going, such as **Working**, **Waiting for
the owner** or **Didn't finish**; click it to go to the box. Running a task puts it in progress;
when the box's turn finishes, the box answers it, and it stays in progress until someone ticks it
off. Whoever runs the box's agent can **Stop** it from the task; a stopped or failed run leaves the
task open, and **Clear** takes its mark off. Tasks run only in your own thread boxes, not in the
room thread's own card; use **Take it to my agent** for that.

### Plan the work

**Plan** in the board's header shows the board's tasks as columns: **To do**, **In progress** and
**Done**. They are the same tasks as on the board, so ticking a task on the board moves it to Done,
and moving it here changes it there, for everyone. Drag a card to another column or place, or use
its menu's **Move to**. **Add a task** at the bottom of a column, or press **C**, adds it there and
on the board, in rows with the other tasks; in a section, the section grows to hold it. Click a card
to change its text, status, assignee, priority or due day; **Show on board** goes to its card, and
**Run with an agent** runs it as on the board. Search, **Only mine**, a person and **Hide done**
narrow what shows, and each column sorts by its own order, priority or due date. Shift-click or
Ctrl-click cards to pick several, then **Move to** moves them together. **List** shows the same
tasks as rows. The address keeps which view is open, so a link to the Plan opens the Plan.

### See where everyone's code is

The thread's card shows the branch the owner's thread works on and whether it is pushed, and each
guest's agent card shows the same for the thread on their machine, for example
`fix/login · 2 commits not pushed`. On a pushed branch, **Copy fetch command** copies the git
commands that fetch it and switch to it. When that machine knows of an open pull request for the
branch, the card links to it. On the owner's board, when the thread's branch has commits and no
pull request, **Open pull request** on the thread's card pushes it and opens one, as the thread's
git action does.

To comment on one message, choose **Comment for the room** beside it in the shared thread. That
comment is a single note, not a [comment thread](#comment-threads): it takes no replies, shows
under that message for everyone, and on the board as a note with **Go to reply** and the start of the reply it is about;
its author or the owner deletes it from either place.

The board belongs to the room. Guests open the same one with **Board** in the thread's header, and
everyone sees a card land where it was dropped and a note once its author clicks away from it.
Anyone in the room can move, resize, connect and edit any card, and tick or assign any task; each
card names who added it. Only that person and the owner can delete a card, a comment included, or
rename a thread box. A board holds up to 50 notes, tasks, links, comments, comment threads,
artifacts and thread boxes of 280 characters, and 100 lines. An agent sees a card only when it is [on a line into a box](#lines-between-cards) someone
prompts, and then only that person's own agent, or the owner's once the owner sends a guest's
message.

The board belongs to the thread, not to the link. Replacing the link, making a new one after it
expired, stopping sharing and archiving the thread all keep it: the next link opens on the same cards, lines, comment
threads and artifacts. While the thread is not shared you keep working on it alone, and your thread
boxes keep showing their turns. Its guests have to join again, as new people. What people from an earlier
link added stays under the name they had, but it is nobody's now, so only the owner can delete it,
and a task cannot be given to them. Their own thread boxes stay as cards showing their last turns,
and no one can prompt them; the owner's boxes keep their threads. To start over, choose **Clear
board** in the **Share with guests** dialog, which removes every card, line and comment thread for
everyone, including from a board kept while the thread is not shared. Removing a guest is
different: it removes what they added and leaves their tasks unassigned.

A thread that is shared or has a board shows a board button on its sidebar row, and the command
palette's **Open board of...** lists those threads. The board opens where you last left it on that
device, panned and zoomed the same, with the same conversation beside it; if that box or its thread
is gone, the thread's own conversation opens instead.

In the sidebar, the arrow on a board's row lists its artifacts, agents and sections without opening
the board. Choose one to open the board with that card in view and selected.

Someone who continued the thread on their own machine has the board in their own Tinkjam: **Board**
in the joined thread's header opens it, and their own boxes run on that machine.

## Boards in the cloud

A cloud board is kept by the board service instead of on your computer, so it opens and can be shared while every computer is off. **New board** makes a cloud board. To keep one on your computer instead, turn on **On this computer** when you choose a template; that computer must be on for others to open the board. New board remembers the place you last chose in this browser.

Everyone on a cloud board can edit it, rename it and copy its invite link from the header. The **here now** button there lists who is on the board. Anyone can **Leave board** from it. The person who made the board can also **Remove** someone, and **Delete board** deletes it for everyone; that cannot be undone. **Remove from my boards** on the home page or sidebar leaves a cloud board too; while its link sharing is on, its link brings you back.

### Link sharing

**Share** on a cloud board has two parts, as in most shared documents: **Link sharing** and the people on the board. Link sharing is one setting. **Anyone with the link can edit**: the edit link lets whoever opens it join under a name and change the board, and the view link lets anyone watch it. **Anyone with the link can view**: only the view link works. **Off**: no link lets anyone new in. Watching from the view link needs no name and no sign-in: viewers can move around, switch between Board, Plan and List, and open links and artifacts, but cannot change anything or bring an agent, and they show as a count ("3 viewing") rather than as people.

The person who made the board, and the owners of its workspace, change link sharing. It takes effect at once: turning it off, or down to view, stops the links letting anyone new in and closes the board for everyone watching from the view link when it goes off, while everyone already on the board keeps their own access. Turning it back on brings back the same links. **New link** on a link makes a new one and stops the old one.

In the list of people they also switch someone between **Can edit** and **Can view**, or remove them. That changes only that person's own access, never the links: while link sharing is on, someone removed can come back through a link they kept, and someone moved to view could join again with the edit link to edit. The list notes that, and the dialog offers to turn link sharing off, down to view or make new links in the same step.

Without signing in, your cloud boards live in this browser only. **Sign in** on the boards home keeps them with your account instead: the boards you make or join while signed in, and the ones this browser already had, show on every device where you sign in, and open there as the same person on the board. Signing out takes your boards, the ones this browser had before you signed in included, and your name off that browser; they stay with your account, so the next person to use it sees nothing of yours.

Signed in, the menu under your picture has **Your account**: the name everyone on your boards sees, your picture and sign-in details, and **Sign out**. Boards you are already on keep the name you joined them with. Deleting all your data in one step is not there yet; delete the boards you made, and leave the others, from each board's menu on the home.

### Workspaces

Signed in, a workspace keeps a team's cloud boards together. Choose **New workspace** in the menu at the top of the boards home, name it and pick a colour. That menu also switches the home and the sidebar between **All boards**, **My boards** and each workspace. **New board** while a workspace is shown puts the board in it; **Move to workspace** in a board's menu moves one you made.

Everyone in a workspace sees its boards and opens them as themselves, without the board's invite link. To bring people in, choose **People**, then **Copy invite link**, and send the link yourself: Tinkjam does not send emails. Whoever opens it signs in, if they have not, and chooses **Join**. An owner can make a **New link**, which stops the old one, or **Turn off link**.

An owner can make someone else an owner, remove someone, or delete the workspace; anyone can leave it. Someone removed, or who left, can no longer open its boards, and their cards on them stay. The last owner must make someone else an owner, or delete the workspace, before leaving. Deleting a workspace does not delete its boards: they stay with everyone already on them. A workspace holds up to 50 people and 500 boards.

### Mentions, your inbox and My tasks

Type `@` in a note, a task, a comment or a reply to pick someone on the board, or in its workspace; use the arrow keys and Enter, or click. Their name shows in their colour, and a mention of you is outlined. A mention only tells that person: it never reaches anyone's agent.

Signed in, the bell on the boards home and in a board's header is your inbox. It shows when someone mentions you, gives you a task, replies to a comment you started, asks to edit a board you manage, or changes what you can do. Choose an item to open its board on that card, or the Plan with that task open; **Mark all read** clears the count. Items stay for 30 days. A board with something new for you has a dot on the home. **My tasks** on the home lists every task given to you, by board.

Someone signed in who can only view a board can choose **Ask for edit access**, with a short note if they like. Whoever made the board, and the owners of its workspace, get it in their inbox with **Approve** and **Decline**; approving lets them edit at once, on the page they have open. One request per person per board can wait at a time. On a board kept on a computer, mentions show, but nothing goes to an inbox.

A cloud board has no agent of its own. Each person brings theirs. When you make a cloud board and this browser has one computer connected, your agent comes along by itself, so **Thread** and **Ask an agent** work at once. Otherwise, or on a board someone invited you to, choose **Thread**, **Ask an agent** or **Attach my agent**. **Bring your agent** lists your computers with whether each is online; choose **Bring my agent** on one and your agent's box appears in the middle of your view, ready for your first prompt, in no project or the project you pick (the next time, the one you picked last). Your thread boxes then run on that computer, and only you can prompt them. A box whose person is not on the board shows **Offline**.

### Connect your computer with Tinkjam Sync

Your agents, such as Claude Code or Codex, are programs on your computer, so a browser cannot run them by itself. Tinkjam Sync is a small app that connects them to your account.

On a Mac or a Windows PC, choose **Bring your agent** (or **Connect a computer**). On Windows, download Tinkjam Sync and open it. On a Mac, open Terminal, paste the line shown there (`curl -fsSL https://tinkjam.com/downloads/install.sh | sh`) and press Return; it asks for no password. Your browser opens by itself: sign in and choose **Connect**. Tinkjam Sync then sits in the menu bar or the system tray, starts with your computer and keeps itself up to date. Its menu shows whether it is connected, and has **Disconnect** and **Quit**. Only one Tinkjam Sync runs per computer, and it replaces any older setup it finds.

You can also have a coding agent install it: copy the prompt under **Or have your coding agent install it** and send it to Claude Code or Codex.

On Linux there is no app yet. With [Node.js](https://nodejs.org) 22.16 or newer, run this in a terminal and open the link it prints:

```
npx -y https://tinkjam.com/sync.tgz --install
```

It runs in the background and starts when you log in; the same command with `--status` shows it, and with `--uninstall` removes it.

Tinkjam Sync runs agents on your computer under your own Claude or Codex sign-in, and they can use what those agents can there. Nothing anyone else writes reaches your agent unless you press **Send**. To disconnect the computer from your account, run the command with `--disconnect` instead; that also stops it running in the background. Tinkjam for desktop, an app that does the same without a terminal, is coming.

Templates that use the board's own thread, code windows and pull request windows are only on boards kept on a computer.

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
contributors**. When they join a link and choose **Sign in** (with the GitHub mark) in the shared thread, their
browser goes to GitHub and comes back, and from then on their messages are sent without asking on
that thread. You can also approve a signed-in guest from the guest names in the thread header.

The first sign-in ties the username to that GitHub account, so someone who takes the username later
is not approved. Removing a username applies to links that person joins afterwards; turn off
**Send without asking** on a thread to stop them there now. The same API key rule applies.

The shared thread offers the sign-in only when the server that runs the thread was started with a
GitHub app's client ID in `T3CODE_GITHUB_APP_CLIENT_ID` and its client secret in
`T3CODE_GITHUB_APP_CLIENT_SECRET`. The app must list
`https://<your Tinkjam Connect host>/api/guest/sign-in/callback` as a callback URL. Tinkjam asks GitHub
for no permissions, reads the guest's username and account number, then discards the token.

## Continue on your own machine

A guest who has Tinkjam can take the thread to their own machine. On the shared thread's page,
choose **Continue on my machine**. It opens Tinkjam, which asks before it contacts the owner's
machine, then shows what comes over and offers:

- **Join with the code**, when you have the same repository on a connected machine. Your thread
  starts in a new worktree from the owner's branch, as its remote has it, and your setup script
  runs on it. Tinkjam tells you when the owner has work that is not pushed yet, because you will
  not get that work.
- **Conversation only**, which starts a thread without a project.

You get your own thread with the conversation as its history, and the agent is handed that history
on your first message. Your turns run on your machine, with your own provider login, model, and
permission mode, so this works on a Claude or ChatGPT plan. Share code back the usual way, with a
branch or a pull request.

The shared thread comes along too: the Tinkjam you joined in lists it under **Shared with me**,
signed in as the same guest, so you read the room and use its [board](#see-the-room-as-a-board)
beside your own thread. **Board** in your joined thread's header opens it. A thread you joined
before this existed has no **Board** button; its board stays where you opened the guest link.

A task someone took to their agent from the board joins the same way,
then lands as a draft in the joined thread; see [Take a task to your agent](#take-a-task-to-your-agent).

### Your turns show in the room

The thread stays connected to the room it came from. When a turn starts in it, Tinkjam tells the
owner's machine your agent is working and on what prompt; when the turn finishes, it sends the
prompt and your agent's final reply. With each, it also sends your thread's branch name, whether
it is pushed, and any open pull request for it, so the room can
[see where your code is](#see-where-everyones-code-is), and which task the turn answers, if you
took one. The owner and every guest see them as your agent's, for example **Sam's agent**. Tinkjam
tells you this before you
join, and the thread header says **Your turns show in the room** while it is on. Choose **Leave
room** there to stop; your thread keeps working as a plain copy, and what the room already shows
stays until the owner stops sharing.

A turn in the thread behind one of your [thread boxes](#thread-boxes) also says, while it runs,
what your agent is doing in a few words ("Thinking", "Running a command", "Waiting for
approval") and its reply as far as it is written, so the room can watch the box and its artifact.

Only that goes back: no files, command output, reasoning, or diffs. A long prompt or reply is
shortened, and the room keeps the 10 most recent turns from all guests. A turn you interrupt, or
one that fails, is not sent, and the room stops showing your agent as working. The room forgets
that your agent is working, and the prompt it showed, once the turn ends or your machine stops
saying so for 10 minutes; neither is kept. The connection ends on its own when the link expires, the owner stops
sharing, or the owner removes you. If the owner extends the link, your machine learns the new end
the next time it posts to the room.

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

**Summarize what I missed**, beside Catch up in the thread header, catches up the same way and
also writes a request in your composer asking your agent to summarize the updates: what was decided,
what changed, open questions, and anything addressed to you. Edit it or send it as it is; if the
room has nothing new, nothing is written.

One catch-up brings at most the 50 most recent updates, as text only, and shortens long ones; the
chip says when something was cut. If the room has ended or the owner removed you, the header stops
saying you are in it.

The copy holds the messages you could see when you chose it, up to the most recent 400. Images and
other files in them stay behind. The link Tinkjam opens is good for 10 minutes; choose **Continue
on my machine** again if it runs out. Joining works on desktop and web, not yet in the mobile app.
A thread you already joined shows **Catch up** and **Leave room** above the composer there; the
mobile app does not show guests' own turns.

## What a guest sees

A guest gets Tinkjam in their browser with the thread in the sidebar, under **Shared with me**. To
put your name over your threads there, set **Settings → Labs → Guest links → Name shown to
guests**; a guest sees a new name the next time they open the thread. Threads from other links they joined in that browser
are listed there too, and someone who uses Tinkjam with their own machines sees shared threads
beside their own. A shared thread is listed for as long as its link lasts.

A guest sees the thread's recent history and everything after, in the same timeline you see, as
it streams: messages and their files, the agent's replies with the images they show from your
machine, its reasoning, plans, questions, and its work, with command output when they expand a
command. Their composer shows the thread's model, but they cannot change it. They do not see
diffs, and they cannot act on the thread: no forking, reverting, opening files on your machine,
stopping a turn, or answering the agent for you. Nothing else on your machine is listed for them:
no other thread, project, terminal, or setting.

Guests also see each other's names, who is away, the messages each of them has waiting, and the
turns guests [ran on their own machines](#your-turns-show-in-the-room). On the board they see the
branch your thread works on, whether it is pushed, and its open pull request.

Anything the agent read or printed can show, such as a value from a file, and a guest can
[take a copy of the conversation](#continue-on-your-own-machine) that stays with them after you stop
sharing. Share only threads you are comfortable showing.

### Where the link opens

A guest link normally opens on your machine's Tinkjam Connect address. If you run a hosted copy of the
Tinkjam web app, start the server with its address in `T3CODE_HOSTED_APP_URL` (for example
`https://app.example.org`) and new links open there instead, naming your machine:
`https://app.example.org/guest?host=<your Tinkjam Connect host>#<invite>`.

With a hosted app, the link you copy is a short readable one, such as
`https://app.example.org/r/tulip-otter-harbor`. Tinkjam Connect keeps what the name stands for until the
link expires, and the hosted app looks it up. The name is the key to the thread, so treat it like
the full link.

The hosted app follows a link only to a machine in its own Tinkjam Connect domain: with the app at
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
