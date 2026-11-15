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
