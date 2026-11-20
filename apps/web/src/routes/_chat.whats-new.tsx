import { createFileRoute } from "@tanstack/react-router";

import { WhatsNewPage } from "../components/WhatsNewPage";

export const Route = createFileRoute("/_chat/whats-new")({
  component: WhatsNewPage,
});
