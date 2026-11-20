import { createFileRoute, redirect } from "@tanstack/react-router";

// The sign-in form makes accounts too, so any link to signing up lands there, with its query and
// fragment (a Clerk return address among them) kept.
export const Route = createFileRoute("/sign-up/$")({
  beforeLoad: ({ location }) => {
    throw redirect({
      href: `/sign-in${location.searchStr}${location.hash ? `#${location.hash}` : ""}`,
      replace: true,
    });
  },
});
