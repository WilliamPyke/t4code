# Onboarding a teammate to this deployment

This fork runs on its own sign-in, relay, and hosted app at `trellium.org`. It has no installer
yet: the installers in the user guide fetch upstream T3 Code, which cannot join these rooms. A
teammate either joins from a browser or runs this fork from source.

## Join a room from a browser

Nothing to install. Open the link the owner sent, such as
`https://app.trellium.org/r/tulip-otter-harbor`, and pick a name. You can follow the thread, send
messages for the owner to approve, and use the board. [Guest links](../user/guest-links.md) covers
the rest.

## Run your own agents

Do this to share your own threads, or to continue a shared thread on your machine with your own
provider login.

1. Install a provider and sign in to it: Claude Code or Codex is enough.
2. Clone the fork and install. `vp` provides the pinned Node version
   ([Install vp](../../README.md#install-vp)); the first install takes several minutes.

   ```bash
   git clone https://github.com/WilliamPyke/t4code.git
   cd t4code
   git switch multiplayer-guest-rooms
   vp i
   ```

3. Create `.env` in the repository root. These are public identifiers, not secrets.

   ```bash
   T3CODE_CLERK_PUBLISHABLE_KEY=pk_test_YWRlcXVhdGUtcXVhaWwtOTQ0Mi5jbGVyay5hY2NvdW50cy5kZXYk
   T3CODE_CLERK_JWT_TEMPLATE=t3-relay
   T3CODE_CLERK_CLI_OAUTH_CLIENT_ID=AxazEzSjlimhMFGf
   T3CODE_RELAY_URL=https://relay.trellium.org
   T3CODE_HOSTED_APP_URL=https://app.trellium.org
   T3CODE_DEV_ALLOWED_ORIGINS=https://app.trellium.org
   ```

4. Start it with `vp run dev --steady` and open the address it prints. On Windows without a
   global `vp`, use `pnpm install --frozen-lockfile` and `pnpm exec vp run dev --steady`.

   `--steady` (or `T3CODE_DEV_STEADY=1`) keeps the server running when files change. Plain
   `vp run dev` restarts the server on every saved file, which is right for developing T Code but
   cuts off your agents' turns and your guests' connections while you use it. Restart the command
   after you pull.

5. In **Settings → Sharing & access**, sign in and link this machine. Then turn on
   **Settings → Labs → Guest links**, and set **Name shown to guests** there.

You can now share a thread (**Share with guests** in the thread menu), and **Continue on my
machine** in a room someone else shared opens in your T Code.

## Things to know

- Your machine must stay on, with `vp run dev --steady` running, while guests use a thread you
  shared.
- Guest messages reach your agent only when you choose **Send**. **Send without asking** works only
  on a Claude or Codex API key, never on a plan sign-in.
- Guests signing in with GitHub works only on a server started with
  `T3CODE_GITHUB_APP_CLIENT_SECRET`. Ask the deployment's owner for it out of band; do not commit
  it.
- To update, `git pull`, run `vp i` again, and restart `vp run dev --steady`. Pull before joining a room: an older build may not
  understand a newer room.
- The sign-in service is a development instance, so the sign-in page shows a development notice.
