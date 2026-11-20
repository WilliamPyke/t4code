import {
  type GuestShareEndpoint,
  guestShareRequest,
  guestShareUrl,
} from "@t3tools/client-runtime/rpc";
import { isProviderSendTurnSupportedImageMimeType } from "@t3tools/contracts";
import { useEffect, useReducer, useState } from "react";

/**
 * Loads a share's files for the page to show. The guest routes take a bearer the page holds, so
 * an `<img>` or a link cannot ask for them: each file is fetched and shown from a blob URL.
 * `url` answers undefined until the file has loaded, and the component renders again when it has.
 */
export function useGuestFiles(endpoint: GuestShareEndpoint) {
  const [files] = useState(() => new Map<string, string | null>());
  const [version, loaded] = useReducer((count: number) => count + 1, 0);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- revokes the blob URLs this view made when it unmounts
  useEffect(
    () => () => {
      for (const url of files.values()) if (url) URL.revokeObjectURL(url);
      files.clear();
    },
    [files],
  );
  const url = (route: string, params: Readonly<Record<string, string>>): string | undefined => {
    const key = guestShareUrl(endpoint, route, params);
    const known = files.get(key);
    if (known !== undefined) return known ?? undefined;
    // Asked for once, whatever the answer: a refused file is not asked for on every render.
    files.set(key, null);
    void guestShareRequest(endpoint, route, { params })
      .then((response) => (response.ok ? response.blob() : null))
      .then((blob) => {
        if (blob === null || !files.has(key)) return;
        files.set(key, URL.createObjectURL(blob));
        loaded();
      })
      .catch(() => {});
    return undefined;
  };
  return { url, version };
}

/**
 * Opens one of a share's files for the guest. Only the image types the server checks byte for
 * byte open in a tab: a blob URL belongs to this page's origin, so anything else that could run
 * there (HTML, SVG) is saved to disk instead.
 */
export async function openGuestFile(
  endpoint: GuestShareEndpoint,
  route: string,
  params: Readonly<Record<string, string>>,
  name: string,
): Promise<void> {
  // Opened in the click itself: a tab opened after the request counts as a popup.
  const tab = window.open("", "_blank");
  const blob = await guestShareRequest(endpoint, route, { params })
    .then((response) => (response.ok ? response.blob() : null))
    .catch(() => null);
  if (blob === null) {
    tab?.close();
    return;
  }
  const url = URL.createObjectURL(blob);
  if (isProviderSendTurnSupportedImageMimeType(blob.type) && tab !== null) {
    tab.opener = null;
    tab.location.href = url;
    return;
  }
  tab?.close();
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
