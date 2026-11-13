import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/models";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useState } from "react";

import { ThreadPicker } from "../ThreadPicker";
import { Dialog, DialogDescription, DialogHeader, DialogPopup, DialogTitle } from "../ui/dialog";

/**
 * Picks one of the viewer's own threads to put on the board as a thread box, and says what the
 * room sees of it from then on. Closes once `onPick` says it went.
 */
export function BoardThreadPicker({
  environmentId,
  excluded,
  onPick,
  onClose,
}: {
  readonly environmentId: EnvironmentId;
  /** Threads that cannot go on this board: the room's own, and those already on it. */
  readonly excluded: ReadonlySet<ThreadId>;
  readonly onPick: (thread: EnvironmentThreadShell) => Promise<boolean>;
  readonly onClose: () => void;
}) {
  const [pending, setPending] = useState(false);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogPopup className="max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Add one of your threads</DialogTitle>
          <DialogDescription>
            The room will see this thread's prompts and replies from now on.
          </DialogDescription>
        </DialogHeader>
        <ThreadPicker
          environmentId={environmentId}
          pending={pending}
          include={(thread) => !excluded.has(thread.id)}
          onSelect={async (thread) => {
            setPending(true);
            const added = await onPick(thread);
            setPending(false);
            if (added) onClose();
          }}
        />
      </DialogPopup>
    </Dialog>
  );
}
