import { APP_DISPLAY_NAME } from "./branding";

let appName = APP_DISPLAY_NAME;
let pageName: string | null = null;

function apply(): void {
  if (typeof document === "undefined") return;
  document.title = pageName === null ? appName : `${pageName} · ${appName}`;
}

/** The app's own name, which a server can restate (its stage, its version). */
export function setDocumentAppName(name: string): void {
  appName = name;
  apply();
}

/** What the tab shows before the app's name: a board's name, or the page's. */
export function setDocumentPageName(name: string | null): void {
  const trimmed = name?.trim() ?? "";
  pageName = trimmed === "" ? null : trimmed;
  apply();
}
