import { createFileRoute } from "@tanstack/react-router";

import { AccountPage } from "../components/boards/AccountPage";

export const Route = createFileRoute("/_chat/account")({
  component: AccountPage,
});
