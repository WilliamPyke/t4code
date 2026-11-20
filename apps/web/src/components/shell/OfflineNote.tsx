import { WifiOffIcon } from "lucide-react";
import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

const readOnline = () => navigator.onLine;

/**
 * A quiet note while this device has no network: nothing on a board can reach anyone until it
 * is back. It says only what the browser knows, and goes away by itself.
 */
export function OfflineNote() {
  const online = useSyncExternalStore(subscribe, readOnline, () => true);
  if (online) return null;
  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-x-0 top-[max(0.5rem,env(safe-area-inset-top))] z-50 flex justify-center px-4"
      data-offline-note
    >
      <p className="flex items-center gap-2 rounded-full border border-border bg-popover px-3 py-1.5 text-xs text-popover-foreground shadow-sm">
        <WifiOffIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        You're offline. Tinkjam reconnects when your connection is back.
      </p>
    </div>
  );
}
