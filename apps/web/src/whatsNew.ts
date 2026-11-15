import * as Schema from "effect/Schema";

import { useLocalStorage } from "./hooks/useLocalStorage";

export interface WhatsNewEntry {
  /** Day it shipped, `YYYY-MM-DD`. */
  readonly date: string;
  readonly title: string;
  readonly items: ReadonlyArray<string>;
}

/** Newest first. Shortcuts are written for Windows and Linux with the Mac key in brackets. */
export const WHATS_NEW: ReadonlyArray<WhatsNewEntry> = [
  {
    date: "2026-11-15",
    title: "Thread boxes keep their model, and templates with agents",
    items: [
      "A thread box keeps the model you pick for it, for everyone and after a reload, until someone picks another or it runs on another. The box's owner and the board's owner can change it.",
      "New thread boxes you add to a board, from Thread or Ask an agent, start on the model you last picked for one of your boxes there.",
      "The Agents list shows each box's model, also before it first runs, and how its last run ended: Done, Stopped or Failed. A run on someone else's machine that sent back no reply says Ended.",
      "On a phone, More shows how many agents need you, and so does Agents in its menu.",
      "Ask an agent on an artifact you selected with other cards asks about all of them, with that artifact as the one to edit.",
      "Show, the Agents list, Show on board and catch-up bring what they show to the middle of the board, between the header and toolbar. If it is already in view, the board stays put.",
      "Ctrl+Z (Cmd+Z) and Ctrl+Y (Cmd+Shift+Z) work on the board right after you click a button outside it, such as the sidebar toggle.",
      "Two new templates with agents: Research with agents has questions, Researcher and Reviewer boxes and a Findings artifact; Build with agents has Backlog, Doing and Done and a Builder box. Plan a feature now has a Spec its agent writes. Their boxes start empty and use your default model.",
      "Run tasks with an agent: select tasks and choose Run with an agent on the selection bar or in the right-click menu, Run with an agent on a task, or Run this section's tasks in a section's menu. Send them all to one thread box, or give each its own new box beside it, up to 4 at once.",
      "A task being run shows its box's name and how it is going, like “Working” or “Didn't finish”, for everyone. Click it to go to the box. A finished turn ticks the task off; Stop ends the run, and Clear takes the mark off a run that did not finish.",
      "Stop a thread box's agent from the box itself, beside its working status, or from its row in the Agents list.",
      "In the Agents list, a box running tasks says “Working on:” and the task. Click the task to go to it.",
      "A task run in a box whose agent is slow to start keeps saying “Starting” until the run begins or ends, instead of “Didn't finish” after 30 seconds, wherever your T3 Code can see that box's runs.",
    ],
  },
  {
    date: "2026-11-15",
    title: "See every agent on a board, and ask one to edit an artifact",
    items: [
      "Ask an agent to edit an artifact: Ask an agent on the artifact card, or select it and press Alt+A (Option+A). Pick “Rewrite this”, “Make it shorter” or “Turn into a web page”, or say what to change. The reply replaces the artifact live for everyone, and Restore previous brings the old version back.",
      "When you ask about an artifact, its box gets a line to it, and a box that already writes it is picked for you. Other cards you selected go with the ask.",
      "Ask an agent shows each box's model, and the model picker beside it lets you change it before you send, also for a new thread box.",
      "Ask an agent closes as soon as you send. If the ask cannot be sent, it opens again with what you typed, and nothing it added stays on the board.",
      "See every agent on a board at once: Agents in the board's header, Alt+G (Option+G), or Agents under More on a phone. Each one says whose it is, its model, what it is doing, like “Working · 1m 12s” or “Needs you”, and what it last did to the board. Click one to go to it.",
      "Approve a guest's prompt or answer your agent's approval right from the Agents list. The Agents button shows how many need you.",
      "When an agent you asked finishes, fails or needs you while its box is out of view, a notice tells you, with Show to go to it.",
      "The minimap outlines the boxes whose agents are working.",
    ],
  },
  {
    date: "2026-11-15",
    title: "Ask an agent about the cards you selected",
    items: [
      "Ask an agent about the cards you selected: Ask an agent on the selection bar or in the right-click menu, or Alt+A (Option+A). Type a question or pick a suggestion like “Turn into tasks”, and choose one of your thread boxes or a new one beside the cards.",
      "The cards you ask about get lines into the box, so everyone sees what the agent was given. If the ask cannot be sent, the lines come off again.",
      "While an agent adds or changes cards, each one briefly shows an outline in its box's colour and the box's name, so you can see where it is working.",
      "One undo takes back a note you just added and typed in, instead of first emptying it.",
      "When Tidy grows a section to fit its cards, whatever the section would cover moves down to make room. One undo puts it all back.",
      "Catch-up counts new replies too, like “2 changes, 1 new reply”, and each step says what is new, like “New comment and 1 reply”.",
      "The board's thread card keeps its size while its agent works, so it no longer grows and shrinks as a reply starts and ends.",
      "As a guest, if the owner's computer stops answering while the board loads, the page says it is retrying and tries again.",
    ],
  },
  {
    date: "2026-11-15",
    title: "Undo what an agent did, and a board you can use on a phone",
    items: [
      "A thread box says what its agent last did to the board, like “Added 4 tasks and 1 section”. Show on board selects those cards.",
      "Undo an agent's whole turn on the board in one step: Undo on its box, or Ctrl+Z (Cmd+Z). Redo brings it back, and cards someone changed since stay as they are.",
      "Select a section to find Tidy and Sort by votes on its toolbar.",
      "Ctrl+Enter (Cmd+Enter) on a note, or its + handle, puts the next note to its right, else below, else further along the row. It never covers another card.",
      "“Changes since you were here” now counts new comments and replies too, and stays until you dismiss it, even after a reload.",
      "Scrolling a thread box's reply no longer moves the board when you reach the end, and Latest takes you back to the newest text.",
      "Team boards show a preview on Boards, like your other boards.",
      "On a phone, Note and Task open the keyboard at once, and the new card lands in clear space above it.",
      "On a phone, dragging a card pans the board. Rest your finger on a card first to pick it up and move it, or let go without moving to open its menu.",
      "On a phone, Fit keeps the board readable: it fills the screen between the header and toolbar, and never zooms out below 35%. A bigger board shows from its top card.",
      "On a touch screen, a selected note shows its +1 and next note buttons above it, big enough to tap at any zoom.",
      "A shared board's header fits a phone: Share stays in view, and Stop sharing moves under More.",
    ],
  },
  {
    date: "2026-11-14",
    title: "Agents that work on the board, votes and catch-up",
    items: [
      "Ask the agent in a thread box, or in the board's own thread, to work on the board: “turn these notes into tasks”, “group the notes by theme”, “summarise the board into a note”. Its cards say which agent made them.",
      "Vote on a note or task: the +1 that shows when you point at it, Alt+V (Option+V) on what you have selected, or Vote in the right-click menu. Point at the count to see who voted.",
      "Sort by votes puts the most voted first: in a section's menu, or for a selection.",
      "Back on a board after a while? “N changes since you were here” steps you through what other people added or changed.",
    ],
  },
  {
    date: "2026-11-14",
    title: "A steadier board, on any screen",
    items: [
      "A thread box keeps its size while its agent replies: the reply scrolls inside it and stays on the newest text.",
      "The minimap shows where everyone's pointer is, as a dot in their colour.",
      "A request a guest sends from their side panel now waits on the board's thread card too, with Send, Dismiss and the model to run it on.",
      "Boards work on a phone: drag with one finger, pinch to zoom, and find Section, Link, Code and Pull request under More in the toolbar. The conversation opens as a sheet over the board.",
    ],
  },
  {
    date: "2026-11-14",
    title: "Boards are home",
    items: [
      "T Code now opens on Boards: every board you have, with a live preview, who is on it and when it last changed. Ctrl+Alt+G (Cmd+Option+G) goes there from anywhere.",
      "New board starts a blank board with its title ready to rename. Ctrl+Alt+Shift+B (Cmd+Option+Shift+B) makes one from anywhere.",
      "Start from a template: Boards → the arrow beside New board, or “New board from template…” in the command palette. Plan a feature, Bug bash, Design review and Retro come with sections and notes to fill in.",
      "A board's thread opens its board from the sidebar, and threads inside a thread box leave the Threads list. Search still finds them.",
      "Boards follow your theme, with quiet controls and a colour for each person.",
    ],
  },
  {
    date: "2026-11-14",
    title: "A board that handles like a canvas tool",
    items: [
      "Right-click the board, a card or a selection to see what you can do there. Shift+F10 does the same for the selected card.",
      "Drag a note or task by its text to move it. Click it again, or just start typing, to write in it.",
      "Ctrl+Enter (Cmd+Enter) or the + on a note's right edge adds the next note beside it, ready to type.",
      "Hold Alt (Option) as you start dragging to drag copies. One undo takes them all back.",
      "A minimap: the map button beside the zoom controls shows or hides it. Click or drag in it to move the view.",
      "What you type in a note, task or section title shows for everyone as you type it.",
    ],
  },
  {
    date: "2026-11-14",
    title: "Context that goes once, and windows on code and pull requests",
    items: [
      "A card on a line into a thread box goes with its next prompt once, then stays out until it changes. Choose Always send to send it every time, or open “already sent” to send one again.",
      "Code windows show what a thread box's agent changed, file by file, with each file's diff.",
      "Pull request windows show a GitHub pull request kept up to date: its state, checks and commits. Paste a pull request link on the board to make one.",
      "An artifact keeps its draft on screen until the finished version lands, with no flash.",
      "A thread box whose agent replies with a web page shows a short summary and offers to put the page in an artifact.",
    ],
  },
  {
    date: "2026-11-13",
    title: "Select, arrange and undo",
    items: [
      "Click a card to select it, click the empty board to let go. Shift-click or Shift-drag selects several, and Ctrl+A (Cmd+A) selects every card.",
      "Arrow keys nudge the selection (Shift for further), Escape cancels a drag, and double-clicking the board adds a note.",
      "Ctrl+C and Ctrl+V copy and paste cards. Pasting text makes a note, and pasting a link makes a link card.",
      "Ctrl+Z undoes your own last change on the board, and Ctrl+Shift+Z or Ctrl+Y redoes it (Cmd on a Mac).",
      "Sections group cards and carry them when moved. Tidy, Duplicate (Ctrl+D) and Group in a section work on a selection.",
      "Six note colours, reactions on cards, and cards that move for everyone while someone drags them.",
    ],
  },
  {
    date: "2026-11-13",
    title: "Comment threads, with agents that answer",
    items: [
      "Choose Comment and click where it belongs. Anyone can reply, resolve it when it is settled, and reopen it later.",
      "A dot on a comment pin means someone replied since you last opened it.",
      "Ask an agent: the bot button beside Send gives the whole thread to one of your thread boxes, and its answer lands as a reply.",
      "A comment placed on a thread box or an artifact connects to it by itself.",
    ],
  },
  {
    date: "2026-11-13",
    title: "A board for every thread",
    items: [
      "Any thread can have a board, shared or not, so you can plan with your own agents before you invite anyone. Choose Open board in the thread's menu or the command palette.",
      "The board belongs to the thread: replacing the link, or making a new one after it ended, keeps every card. Clear board starts over.",
      "Links last 1, 7 or 30 days, and Extend link adds more time without losing anyone.",
      "The board's header shows who is in the room and opens sharing. The board reopens where you left it.",
      "Put a thread you already have on the board: Thread → Add one of your threads.",
      "When your agent in a thread box asks for permission, approve it right on the box.",
    ],
  },
  {
    date: "2026-11-12",
    title: "Thread boxes, and lines that carry context",
    items: [
      "Anyone in the room can add a thread box: a conversation of its own, with a model picker, showing what its agent is doing and for how long.",
      "Draw a line from a note, task or link into a thread box and it goes with that box's next prompt. You see it as a chip and can leave it out.",
      "Artifacts: draw a line from a thread box to an artifact and the box's replies fill it, written live for everyone. A full web page shows as the page itself.",
      "Restore previous brings back the version an artifact replaced.",
      "Resize any card from its bottom corners. Everyone sees the new size.",
      "A teammate who continued on their own machine runs their thread boxes on their own agent, and the room watches it work.",
    ],
  },
  {
    date: "2026-11-12",
    title: "Teams, tasks and live pointers",
    items: [
      "Teams: choose + beside Teams in the sidebar and invite people with a link. Members join with their T Connect account, and a thread shared with a team stays listed for 90 days.",
      "Each team has a board with a card for every thread shared with it.",
      "Tasks you can assign. Take it to my agent puts a task in your message box, and the finished turn ticks it off.",
      "See everyone's pointer on the board with their name, and click a name to follow them.",
      "Drag a note onto the thread's card, or choose Use as message, to put its text in your message box.",
      "The thread's card shows its branch, commits not pushed, and its pull request. Summarize what I missed drafts a catch-up for your own agent.",
    ],
  },
  {
    date: "2026-11-11",
    title: "Guests in the full app",
    items: [
      "With a hosted app, a guest link opens the full T Code app, with shared threads under Shared with me.",
      "Links can be three easy words, like /r/tulip-otter-harbor. Share with guests again shows the same link, and Replace link makes a new one.",
      "Settings → Labs → Guest links → Name shown to guests labels your threads in a guest's sidebar.",
      "Guests can sign in with GitHub, and messages from your approved contributors send without asking.",
      "Turns your guests run on their own machines show in the room, and Catch up shows what others did.",
      "Guests no longer see your folder paths.",
    ],
  },
  {
    date: "2026-11-10",
    title: "Guest links become rooms",
    items: [
      "Up to 8 people can join one guest link, each under their own name.",
      "Everyone sees each other's waiting messages, and you send or dismiss each one.",
      "Remove a guest, and see who has the thread open right now.",
      "Let a guest send without asking when the thread's provider signs in with an API key.",
      "Continue on my machine takes the thread to a guest's own T Code, on your branch if they like.",
    ],
  },
];

const SEEN_KEY = "t-code:whats-new-seen";
const SeenSchema = Schema.NullOr(Schema.String);
// The count makes a second entry on the same day show as unread too.
const LATEST = `${WHATS_NEW[0]?.date ?? ""}#${String(WHATS_NEW.length).padStart(4, "0")}`;

/** Whether this browser has entries it has not seen yet, and a way to mark them seen. */
export function useWhatsNewSeen() {
  const [seen, setSeen] = useLocalStorage(SEEN_KEY, null, SeenSchema);
  return {
    unseen: seen === null || seen < LATEST,
    markSeen: () => {
      if (seen !== LATEST) setSeen(LATEST);
    },
  };
}
