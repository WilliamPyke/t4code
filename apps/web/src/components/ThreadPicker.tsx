import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId } from "@t3tools/contracts";
import { CheckIcon, MessageSquareIcon } from "lucide-react";
import { useState } from "react";

import { useProjects, useVisibleThreadShells } from "~/state/entities";
import { useThreadSearch } from "~/state/queries";

import { Command, CommandInput, CommandItem, CommandList } from "./ui/command";

/**
 * One environment's active threads, newest first, searchable by title or project, to pick one.
 * `include` narrows the list; a thread `chosen` names is shown checked with its label, and
 * cannot be picked again.
 */
export function ThreadPicker({
  environmentId,
  pending,
  include,
  chosen,
  onSelect,
}: {
  readonly environmentId: EnvironmentId;
  readonly pending: boolean;
  readonly include?: ((thread: EnvironmentThreadShell) => boolean) | undefined;
  readonly chosen?:
    | {
        readonly has: (thread: EnvironmentThreadShell) => boolean;
        readonly label: string;
      }
    | undefined;
  readonly onSelect: (thread: EnvironmentThreadShell) => void;
}) {
  const threads = useVisibleThreadShells();
  const projects = useProjects();
  const [query, setQuery] = useState("");
  // Mounts older settled threads matching the query, which shells may leave out.
  useThreadSearch([environmentId], query, { titlesOnly: true });
  const projectNames = new Map(
    projects
      .filter((project) => project.environmentId === environmentId)
      .map((project) => [project.id, project.title]),
  );
  const search = query.trim().toLocaleLowerCase();
  const candidates = threads
    .filter(
      (thread) =>
        thread.environmentId === environmentId &&
        thread.archivedAt === null &&
        thread.deletedAt === null &&
        (include === undefined || include(thread)) &&
        `${thread.title} ${projectNames.get(thread.projectId) ?? ""}`
          .toLocaleLowerCase()
          .includes(search),
    )
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return (
    <Command mode="none" value={query} onValueChange={setQuery} aria-label="Choose a thread">
      <CommandInput placeholder="Search threads or projects..." disabled={pending} />
      <CommandList className="max-h-80 overflow-y-auto">
        {candidates.length === 0 ? (
          <div className="px-3 py-6 text-center text-sm text-muted-foreground">
            No active threads found.
          </div>
        ) : (
          candidates.map((thread) => {
            const done = chosen?.has(thread) === true;
            return (
              <CommandItem
                key={thread.id}
                value={thread.id}
                disabled={pending || done}
                onClick={() => onSelect(thread)}
              >
                <MessageSquareIcon aria-hidden className="size-4 shrink-0" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{thread.title || "Untitled thread"}</span>
                  <span className="truncate text-xs text-muted-foreground">
                    {projectNames.get(thread.projectId)}
                  </span>
                </span>
                {done ? (
                  <>
                    <CheckIcon aria-hidden className="size-3.5" />
                    <span className="text-xs text-muted-foreground">{chosen?.label}</span>
                  </>
                ) : null}
              </CommandItem>
            );
          })
        )}
      </CommandList>
    </Command>
  );
}
