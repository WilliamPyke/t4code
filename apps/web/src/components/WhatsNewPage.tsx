import { ChevronDownIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { WHATS_NEW, type WhatsNewEntry, useWhatsNewSeen } from "~/whatsNew";

import { Badge } from "./ui/badge";
import { Dialog, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from "./ui/dialog";
import { useCloseAppModal } from "./sidebar/mainAppLocation";

// The day the newest entries shipped: each of them is marked New.
const LATEST_DAY = WHATS_NEW[0]?.date ?? "";

function formatDay(date: string): string {
  // A date with no time parses as local midnight, so the day never shifts with the time zone.
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
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

/** What's new, as a dialog over the page that opened it; closing goes back there. */
export function WhatsNewPage() {
  const { markSeen } = useWhatsNewSeen();
  const closeAppModal = useCloseAppModal();
  const [open, setOpen] = useState(true);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- records in browser storage that this browser has read the page
  useEffect(() => markSeen());

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setOpen(false);
      }}
      onOpenChangeComplete={(next) => {
        if (!next) void closeAppModal();
      }}
    >
      <DialogPopup className="sm:max-w-lg" data-whats-new>
        <DialogHeader>
          <DialogTitle>What's new</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <ol className="flex flex-col gap-6">
            {byDay(WHATS_NEW).map((day) => (
              <li key={day.date} className="flex flex-col gap-1">
                <h2 className="text-2xs font-semibold tracking-widest text-muted-foreground uppercase">
                  <time dateTime={day.date}>{formatDay(day.date)}</time>
                </h2>
                <ul className="flex flex-col">
                  {day.entries.map((entry) => (
                    <li key={entry.title} className="border-b">
                      <details className="group">
                        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-md py-2.5 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset [&::-webkit-details-marker]:hidden">
                          <h3 className="min-w-0 flex-1 text-ui-md font-medium text-pretty">
                            {entry.title}
                          </h3>
                          {entry.date === LATEST_DAY ? (
                            <Badge variant="accent" size="status">
                              New
                            </Badge>
                          ) : null}
                          <ChevronDownIcon
                            aria-hidden
                            className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
                          />
                        </summary>
                        <ul className="mb-3 flex list-disc flex-col gap-1.5 ps-5 text-sm leading-relaxed text-pretty text-muted-foreground marker:text-muted-foreground">
                          {entry.items.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </details>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
