import { useEffect } from "react";

import { isElectron } from "~/env";
import { workspaceAreaProps } from "~/lib/workspaceFocus";
import { WHATS_NEW, type WhatsNewEntry, useWhatsNewSeen } from "~/whatsNew";

import { SidebarInset } from "./ui/sidebar";
import { WorkspacePageHeader } from "./WorkspacePageHeader";

function formatDay(date: string): string {
  // A date with no time parses as local midnight, so the day never shifts with the time zone.
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function byDay(entries: ReadonlyArray<WhatsNewEntry>) {
  const days: Array<{ date: string; entries: Array<WhatsNewEntry> }> = [];
  for (const entry of entries) {
    const last = days.at(-1);
    if (last?.date === entry.date) last.entries.push(entry);
    else days.push({ date: entry.date, entries: [entry] });
  }
  return days;
}

export function WhatsNewPage() {
  const { markSeen } = useWhatsNewSeen();
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- records in browser storage that this browser has read the page
  useEffect(() => markSeen());

  return (
    <SidebarInset
      {...workspaceAreaProps("home", 1, "What's new")}
      role="main"
      className="h-dvh min-h-0 overflow-y-auto overscroll-y-none scrollbar-gutter-both"
      data-whats-new
    >
      {isElectron ? (
        <WorkspacePageHeader electron />
      ) : (
        // Room for the floating sidebar button on phones.
        <WorkspacePageHeader className="md:hidden" />
      )}
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-6 sm:px-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-2xl leading-tight font-semibold">What's new</h1>
          <p className="text-sm text-muted-foreground">
            What changed in T Code, newest first, and where to find it.
          </p>
        </header>
        <ol className="flex flex-col gap-8">
          {byDay(WHATS_NEW).map((day) => (
            <li key={day.date} className="grid gap-3 sm:grid-cols-[9rem_1fr] sm:gap-6">
              <h2 className="text-sm font-medium text-muted-foreground sm:pt-3">
                <time dateTime={day.date}>{formatDay(day.date)}</time>
              </h2>
              <div className="flex min-w-0 flex-col gap-3">
                {day.entries.map((entry) => (
                  <article
                    key={entry.title}
                    className="rounded-board border border-board-hairline bg-card px-4 py-3.5 text-card-foreground shadow-paint"
                  >
                    <h3 className="text-base font-semibold">{entry.title}</h3>
                    <ul className="mt-2 flex list-disc flex-col gap-1.5 ps-5 text-sm leading-relaxed text-pretty marker:text-muted-foreground">
                      {entry.items.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  </article>
                ))}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </SidebarInset>
  );
}
