import { type WelcomeDraft, parseWelcomeDraft, serializeWelcomeDraft } from "./welcomeDraft.logic";

// Per tab, so it ends with the tab: never another visit's, and never another tab's.
const DRAFT_KEY = "t3code:welcome-draft:v1";

export function readWelcomeDraft(templateIds: ReadonlyArray<string>): WelcomeDraft {
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(DRAFT_KEY);
  } catch {
    // Blocked storage only means the form starts empty after a page load.
  }
  return parseWelcomeDraft(raw, templateIds);
}

export function keepWelcomeDraft(draft: WelcomeDraft) {
  try {
    window.sessionStorage.setItem(DRAFT_KEY, serializeWelcomeDraft(draft));
  } catch {}
}

export function clearWelcomeDraft() {
  try {
    window.sessionStorage.removeItem(DRAFT_KEY);
  } catch {}
}
