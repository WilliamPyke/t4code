# Environment authentication

The environment issues its own sessions and enforces their capabilities. Cloud
identity and relay credentials belong to a separate trust boundary, described in
[T3 Connect](./t3-connect.md). A relay token is never an environment login.

## Authority survives transport changes

Pairing delegates a set of scopes. Exchanging a bootstrap credential can narrow
that grant but cannot widen it. The default grant includes access and relay
management: `terminal:operate` is a shell as the server's user and
`orchestration:operate` can start a full-access agent, and either can mint a
session with every scope through `t3 auth session issue`, so withholding
management from the default would not be a boundary. A narrower client gets
explicit scopes. Creating another pairing link requires both `access:write` and
every scope being delegated. The
[auth handlers](../../apps/server/src/auth/http.ts) enforce this at issuance;
client labels and device metadata have no authorization role.

The access read model contains pairing metadata, never recoverable pairing
secrets. Only the creation response returns the raw credential. Otherwise read
access to the connections list would become a way to acquire another client's
authority.

Browser cookies, bearer tokens, and DPoP tokens adapt the same scoped session
model. DPoP binds a token to a client's proof key; an invalid proof must fail
rather than fall back to bearer authentication. The OAuth token-exchange
vocabulary gives these grants a familiar meaning.

### Guest links are not sessions

A [guest link](../user/guest-links.md) gives a few browsers read access to one
thread and a way to propose messages. Its tokens are HMACs of the thread, share,
and guest id under a server key ([GuestShareService](../../apps/server/src/guest/GuestShareService.ts)),
so nothing secret is stored. The share in the thread projection is the only
state: replacing, closing, or archiving it revokes every token, and the
orchestrator's serial commands cap who joins and make each send happen once. Guest
tokens never enter `SessionStore`, so no RPC, WebSocket, or MCP path can accept
one. Guest routes also require T3 Connect to still serve the link's hostname;
the request's Host header is not checked, because a LAN client can forge it.

A guest's page can be on another origin than the owner's host: the hosted app
opens guest links when the owner's server is told about it
(`T3CODE_HOSTED_APP_URL`). The session cookie is `SameSite=Strict` and cannot
cross origins, so a redeem that asks gets the token in its body and the session
routes take it as a bearer. That widens nothing: the bearer is the cookie's
value, each route still names its share and drops a bearer signed for another,
and the routes stay uncredentialed for CORS. In the client the share is an
environment whose session is built on those routes
([guestSession](../../packages/client-runtime/src/rpc/guestSession.ts)). It
answers the config, the shell and the one thread, and every other RPC fails
there without a request, so the environment API never sees a guest token. The
hosted app keeps the token in page storage, which any script on that origin can
read: it must stay a guest's token, good for one thread and a day. The `host` a
link names is untrusted, and the page follows it only into the deployment's own
tunnel zone ([guestLinks](../../packages/shared/src/guestLinks.ts)), because it
sends that host a name and then holds a token for it.

A guest can also take the thread to their own T3 Code. The guest page asks for a
handoff token, a signed claim like the session's that lasts ten minutes and opens
only the thread's export, and passes it with this host's name to the guest's own
app. The guest's server then reads the export
([SharedThreadJoin](../../apps/server/src/guest/SharedThreadJoin.ts)) and creates
a thread of its own with that history. The export and room routes are the guest
routes a server calls, so they take a bearer token, not the cookie. The host in
such a link is untrusted: the joining server calls only a public-looking https
name, never follows a redirect with a token, and asks the user first. The export
names the repository by its key, never its remote URL, which can hold a
credential.

The export also carries a room token, a third kind of signed claim. It lasts as
long as the share and does two things: post a turn the guest ran on their own
machine, as text, for the room to read, and read what the room said after a
cursor. The guest's server keeps it in its secret
store, not on the thread, and posts each finished run
([SharedRoomLink](../../apps/server/src/guest/SharedRoomLink.ts)). The owner's
side stores a few such turns on the share, bounded in count, size, and rate, and
only shows them. A posted turn must never start a run or become a message in the
owner's thread: a plan sign-in covers the account holder's own prompts, and that
text was written on someone else's machine. A room that has ended answers 410,
which disconnects the guest's thread; a tunnel that is down or a beta that is off
answers 403, which may pass.

The same rule holds in the other direction. What the room said reaches the
guest's machine only when its user asks (`sharedThread.catchUp`), and only as
text the client attaches to that user's next message as a `room-updates` context
record. Nothing on that path may dispatch a message or start a run: the joiner's
plan covers the joiner's prompts, not the room's. Both servers bound and
sanitize the text, since each is untrusted to the other, and the prompt
projection labels it as other people's words. Advancing the cursor on fetch, not
on send, is deliberate: a chip the user removes is a choice not to pass those
updates on.

A guest's message normally reaches the agent only when the owner sends it. The
owner can trust one guest, and then the server sends that guest's messages
itself, but only while the thread's provider is signed in with an API key
(`providerAllowsDirectGuestSend`). That check is about provider terms, not
security: a plan sign-in covers only the account holder's own prompts. Add a
driver to it only after reading that provider's terms.

A guest's typed name is not an identity. A guest can prove a GitHub account with
the web redirect flow ([GuestSignIn](../../apps/server/src/guest/GuestSignIn.ts)):
the server reads the login and id, then drops the token. It is not the device
flow, because GitHub's device page shows the approver the IP and location of the
machine that asked for the code, which is the owner's. The callback arrives
without the guest session (that cookie is `SameSite=Strict`), so a one-time
`state` held in memory names the session, and a separate `SameSite=Lax` cookie
must match it: otherwise a guest could pass their GitHub link to someone else and
be recorded as that person. A page on the hosted app cannot store that cookie
from a fetch, so it posts a form to the owner's host instead, a navigation whose
answer sets the cookie and redirects to GitHub. That route takes the post only
from the hosted app's origin: a form any page could post would let an attacker
walk a victim's browser through the attacker's own sign-in, which is the attack
the cookie exists to stop. The callback then returns the browser to the hosted
app, an address the server holds, never one the request names. The owner's saved
contributors are matched by login the first time and by id after that, because a
login can be renamed away and taken by someone else.

### MCP clients are a separate audience

Agents T3 Code did not launch sign in to `/mcp` through a narrow OAuth
authorization-code server ([McpOAuth](../../apps/server/src/auth/McpOAuth.ts)).
It accepts loopback redirect URIs for agents on the user's machine and any
HTTPS redirect for hosted agents (ChatGPT, bots). An HTTPS redirect means a
link someone else sends the owner can deliver access to that someone, so the
approval page names the host access goes to and approving stays the owner's
call. Every client is public and proves itself with PKCE; a client that asks
for a secret is registered without one. Client registration is stateless, so an unauthenticated caller cannot grow server
state. Approval spends a one-time pairing code, or uses a browser session with
`access:write`; proof-bound T3 Connect codes are refused without being spent.

The user grants either read-only access or a runtime-mode ceiling, not a
scope list: MCP tools are all orchestration, and `orchestration:operate`
alone would let an agent start a thread in full access and act through it.
The result is an ordinary session with subject `mcp-client`. A read-only
grant holds `orchestration:read` alone. On `/mcp` it passes only tools
declared as reads in [McpToolAccess](../../apps/server/src/mcp/McpToolAccess.ts),
where every tool must declare who may call it to compile. Any other grant adds
`orchestration:operate` and a signed ceiling. Only `/mcp` accepts these sessions. Every other HTTP and WebSocket
path rejects that subject, because the RPC surface would let the agent act
above its ceiling. Inside MCP the credential sets the limits and tool
parameters only pick targets; see
[threadAccess](../../apps/server/src/mcp/threadAccess.ts).

Issuer and resource URLs come from the request's Host and
`X-Forwarded-Proto`, so one server answers over loopback, Tailscale Serve and a
T3 Connect tunnel. A proxy that rewrites Host or drops the protocol header
breaks sign-in.

Bearer and DPoP clients obtain short-lived WebSocket tickets through authenticated
HTTP so long-lived tokens stay out of socket URLs. A ticket names the route it
opens: the RPC socket, or the media routes (device hub, preview stream), which
share one ticket across `<img>`, `EventSource` and several sockets. A DPoP
client's RPC ticket is bound to its proof key and the upgrade carries a fresh
proof in the `dpop` query parameter, since a WebSocket cannot set headers; a
ticket captured on a plain HTTP LAN route is useless without the key, and the
proof's `jti` is consumed like any other. Media tickets stay bearer because each
media request would need its own proof. Clients that predate this mint unbound
tickets that open either route. Browser sessions can authenticate the upgrade
with their cookie. A successful handshake grants no
extra authority: [every RPC declares a required
scope](../../apps/server/src/auth/RpcAuthorization.ts), and the WebSocket RPC
group's `RpcScopeAuthorization` middleware checks it before any handler runs.

Scope changes must not prevent older clients from connecting. Token exchange
intersects recognized requests with the pairing grant; retired and unknown names
are dropped. A request with no granted scopes fails before consuming the link.
Stored credentials are never expanded when scopes split.

Auth responses keep `scopes` within the original wire vocabulary and include
`permissions` for the exact grant. New clients use `permissions` when present,
even if empty. Older servers omit it, so clients use legacy parent checks for
features those servers already support. These client checks never change server
authorization. Permission errors likewise retain a legacy `requiredScope` and
add the exact `requiredPermission`, so a denied RPC stays decodable by old clients.
Unknown response permissions are ignored; grant inputs stay strict.

Desktop restarts forget the previous local bearer token, so its reusable
bootstrap grant replaces earlier sessions for the same subject and method.
Revocation and insertion share a [database
transaction](../../apps/server/src/persistence/AuthSessions.ts); a failed
replacement must leave the old credential usable. Pairing and browser sessions
do not follow this replacement rule.

### Reusable dev credential

Web development environments can accept one `T3CODE_DEV_AUTH_TOKEN` across
worktrees and ports on one hostname. The token and startup URLs that contain it
grant administrative access. Desktop and non-development servers ignore it. See
the [development runbook](../operations/development.md#reusable-dev-credential)
for setup.

Each environment hashes the value and seeds its own database record at startup.
Environments do not share SQLite data, signing keys, environment IDs, session
records, pairing grants, or revocation state. Local revocation persists after
restart and does not affect another worktree. Removing or rotating the value
and restarting invalidates the old credential and its WebSocket tickets.

Normal credentials keep precedence. A rejected normal credential never falls
back to the reusable credential. OAuth exchanges create ordinary local bearer
or DPoP children with normal expiry and revocation. The reusable cookie expires
after 30 days.

## The environment is the filesystem boundary

Projects are organizational boundaries, not filesystem sandboxes.
`filesystem:read` permits reading files the server account can read, including
absolute paths outside a project. This lets clients display artifacts that an
agent writes in a temporary directory. Relative paths and writes still follow
the [workspace path rules](../../apps/server/src/workspace/WorkspaceFileSystem.ts).

Signed asset URLs are bearer credentials. A URL for media on the host grants
access to one canonical file and its device/inode identity, not its containing directory.
[Asset access](../../apps/server/src/assets/AssetAccess.ts) rechecks the opened
file's identity when serving it, so atomic replacement requires a new URL while
editing the same file in place does not. An HTML file authorized this way cannot
load sibling assets; directory-scoped workspace previews are a separate grant.
Clients should share the authored file reference so they do not disclose the
temporary URL's credential. `filesystem:read` is checked when the URL is minted,
not when it is served: a URL issued before the grant was revoked keeps working
until it expires, and it is not bound to the session that minted it.

Host videos can change in place. Their [HTTP
responses](../../apps/server/src/http.ts) omit cache validators because file
metadata cannot prove byte-for-byte identity for `If-Range`. Adding weak
validators would turn native-player seeks into full downloads.
