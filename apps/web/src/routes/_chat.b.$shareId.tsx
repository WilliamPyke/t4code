import { createFileRoute } from "@tanstack/react-router";

import { cloudBoardRouteParams } from "../guest/boardAddress";

// A cloud board's own address. The _chat layout shows the thread these params name.
export const Route = createFileRoute("/_chat/b/$shareId")({
  params: {
    parse: ({ shareId }) => cloudBoardRouteParams(shareId),
    stringify: ({ shareId }) => ({ shareId }),
  },
  component: () => null,
});
