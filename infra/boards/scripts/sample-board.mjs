#!/usr/bin/env node
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

// Node (23.6 or newer) runs this TypeScript file as it is: it imports only types.
import { sampleChanges, sampleTurns } from "../src/sampleBoard.ts";

const USAGE = `Builds Tinkjam's public sample board from infra/boards/sample/onboarding-v2.json,
through the board host's own routes, and prints its view link.

  node infra/boards/scripts/sample-board.mjs --host https://boards.trellium.org

The public sample board was made through boards.trellium.org, and its state file is named after
that host: keep passing it (the same service answers at boards.tinkjam.com).

  --host <url>    the board host (required); http://localhost:8799 for \`wrangler dev\`
  --app <url>     the web app the link opens in (default https://app.tinkjam.com)
  --state <file>  where the board's sessions are kept, outside the repository
                  (default ~/.tinkjam/sample-board.<host>.json)
  --fresh         deletes the board in the state file and makes a new one, with a new view link

No account or secret is needed: an anonymous maker makes the board and the state file keeps its
session. Running again updates the same board and keeps its view link. The edit link is turned
off at the end, so nobody else can change the board; viewers may make their own copy of it.`;

const { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } = NodeFS;
const { dirname, join } = NodePath;
const here = dirname(NodeURL.fileURLToPath(import.meta.url));
const SAMPLE = join(here, "..", "sample", "onboarding-v2.json");

function argsOf(argv) {
  const args = { app: "https://app.tinkjam.com", fresh: false };
  for (let at = 0; at < argv.length; at++) {
    const flag = argv[at];
    if (flag === "--fresh") args.fresh = true;
    else if (flag === "--host" || flag === "--app" || flag === "--state") {
      args[flag.slice(2)] = argv[++at];
    } else {
      console.log(USAGE);
      process.exit(flag === "--help" ? 0 : 1);
    }
  }
  if (!args.host) {
    console.log(USAGE);
    process.exit(1);
  }
  args.host = args.host.replace(/\/+$/, "");
  args.state ??= join(
    NodeOS.homedir(),
    ".tinkjam",
    `sample-board.${new URL(args.host).host.replace(/[^a-z0-9.-]/gi, "_")}.json`,
  );
  return args;
}

const args = argsOf(process.argv.slice(2));
const sample = JSON.parse(readFileSync(SAMPLE, "utf8"));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** One request to the board host; retries while it says too many requests. */
async function call(method, route, { token, share, body } = {}) {
  const url = new URL(route, `${args.host}/`);
  if (share) url.searchParams.set("share", share);
  for (let attempt = 0; ; attempt++) {
    const response = await fetch(url, {
      method,
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.status === 429 && attempt < 6) {
      await sleep(15_000);
      continue;
    }
    const text = await response.text();
    const json = text === "" ? null : JSON.parse(text);
    return { ok: response.ok, status: response.status, json };
  }
}

async function must(method, route, options, what) {
  const result = await call(method, route, options);
  if (!result.ok) {
    // An older board host answers its unknown routes with 404 "unavailable".
    const older =
      result.status === 404 && result.json?.reason === "unavailable"
        ? " (this board host is older than the script: deploy infra/boards, wait a minute, run again)"
        : "";
    throw new Error(`${what}: ${result.status} ${result.json?.message ?? ""}${older}`.trim());
  }
  return result.json;
}

/** The first view the board's stream sends to `token`, then the stream is closed. */
async function readView(token, share) {
  const url = new URL("/api/guest/stream", `${args.host}/`);
  url.searchParams.set("share", share);
  const abort = new AbortController();
  const response = await fetch(url, {
    headers: { authorization: `Bearer ${token}` },
    signal: abort.signal,
  });
  if (!response.ok || response.body === null) return null;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return null;
      buffered += decoder.decode(value, { stream: true });
      let end;
      while ((end = buffered.indexOf("\n\n")) !== -1) {
        const frame = buffered.slice(0, end);
        buffered = buffered.slice(end + 2);
        if (!frame.startsWith("data: ")) continue;
        const event = JSON.parse(frame.slice(6));
        if (event.type === "view") return event.view;
      }
    }
  } finally {
    abort.abort();
  }
}

function loadState() {
  if (!existsSync(args.state)) return null;
  return JSON.parse(readFileSync(args.state, "utf8"));
}

function saveState(state) {
  mkdirSync(dirname(args.state), { recursive: true });
  writeFileSync(args.state, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(args.state, 0o600);
  } catch {}
}

async function main() {
  let state = loadState();
  if (state !== null && args.fresh) {
    await call("DELETE", "/api/boards", {
      token: state.people[sample.maker].token,
      share: state.shareId,
    });
    state = null;
  }
  if (state !== null) {
    const alive = await call("GET", "/api/guest/session", {
      token: state.people[sample.maker].token,
      share: state.shareId,
    });
    if (!alive.ok) {
      console.warn(
        "The board in the state file is gone; making a new one (it gets a new view link).",
      );
      state = null;
    }
  }
  let editCredential = null;
  if (state === null) {
    const created = await must(
      "POST",
      "/api/boards",
      { body: { name: sample.people[sample.maker], title: sample.title } },
      "Making the board",
    );
    editCredential = created.credential;
    state = {
      host: args.host,
      shareId: created.shareId,
      people: { [sample.maker]: { token: created.token } },
    };
    saveState(state);
  }
  const share = state.shareId;
  const maker = state.people[sample.maker].token;

  // Everyone else joins once, by the edit link, under their name.
  for (const [key, name] of Object.entries(sample.people)) {
    if (state.people[key]?.token) continue;
    editCredential ??= (
      await must(
        "POST",
        "/api/boards/links",
        { token: maker, share, body: { kind: "edit", on: true } },
        "Turning the edit link on",
      )
    ).credential;
    const joined = await must(
      "POST",
      "/api/guest/redeem",
      { body: { credential: editCredential, name, returnToken: true } },
      `Joining ${name}`,
    );
    state.people[key] = { token: joined.token };
    saveState(state);
  }
  for (const [key, person] of Object.entries(state.people)) {
    if (person.guestId) continue;
    const view = await readView(person.token, share);
    if (view?.guestId === undefined) throw new Error(`Could not read who ${key} is on the board`);
    person.guestId = view.guestId;
    saveState(state);
  }
  const tokenOf = (key) => {
    const token = state.people[key]?.token;
    if (!token) throw new Error(`Nobody called "${key}" in the sample's people`);
    return token;
  };
  const guestOf = (key) => state.people[key].guestId;
  const change = async (by, body, what) => {
    await must("POST", "/api/guest/board", { token: tokenOf(by), share, body }, what);
    await sleep(80);
  };

  const before = await readView(maker, share);
  const board = before?.board ?? { notes: [], edges: [] };
  const wanted = new Set(sample.cards.map((card) => card.id));
  const wantedLines = new Set(sample.lines.map((line) => line.id));
  const authorOf = (guestId) =>
    Object.keys(state.people).find((key) => state.people[key].guestId === guestId);

  // What an earlier description had and this one does not.
  for (const edge of board.edges ?? []) {
    if (wantedLines.has(edge.id)) continue;
    const by = authorOf(edge.guestId) ?? sample.maker;
    const removed = await call("POST", "/api/guest/board", {
      token: tokenOf(by),
      share,
      body: { type: "edge.remove", edgeId: edge.id },
    });
    if (!removed.ok)
      console.warn(`Left line ${edge.id}: ${removed.json?.message ?? removed.status}`);
  }
  for (const note of board.notes) {
    if (wanted.has(note.id)) continue;
    const by = authorOf(note.guestId);
    if (by === undefined) {
      console.warn(`Left card ${note.id}: nobody the script knows added it`);
      continue;
    }
    await change(by, { type: "note.remove", noteId: note.id }, `Removing ${note.id}`);
  }

  const bodyOf = (file) => readFileSync(join(dirname(SAMPLE), file), "utf8");
  const changes = sampleChanges({
    sample,
    guestOf,
    bodyOf,
    notes: board.notes,
    start: board.start,
    now: Date.now(),
  });
  for (const { by, change: one } of changes) {
    await change(by, one, `${one.type} ${one.noteId ?? one.edgeId ?? ""}`.trim());
  }

  // The finished agent turns the sample shows, posted as each person's own Tinkjam posts a turn
  // its agent ran: a handoff from their seat opens the export, whose room token posts the turn.
  // Nothing runs an agent. Each turn has a fixed id, so posting it again changes nothing.
  const roomTokenOf = async (key) => {
    if (state.people[key].room) return state.people[key].room;
    const handoff = await must(
      "POST",
      "/api/guest/handoff",
      { token: tokenOf(key), share, body: {} },
      `Opening ${key}'s seat to post the sample's agent turns`,
    );
    const exported = await must(
      "GET",
      "/api/guest/export",
      { token: handoff.token },
      `Reading the board for ${key}'s turns`,
    );
    state.people[key].room = exported.room.token;
    saveState(state);
    return state.people[key].room;
  };
  for (const { by, turn } of sampleTurns({ sample, bodyOf })) {
    let posted = await call("POST", "/api/guest/room/turns", {
      token: await roomTokenOf(by),
      body: turn,
    });
    if (posted.status === 410 || posted.status === 403) {
      // The board forgot that token: make a new one and post once more.
      delete state.people[by].room;
      posted = await call("POST", "/api/guest/room/turns", {
        token: await roomTokenOf(by),
        body: turn,
      });
    }
    if (!posted.ok) {
      throw new Error(`Posting ${turn.id}: ${posted.status} ${posted.json?.message ?? ""}`.trim());
    }
    await sleep(80);
  }

  await must(
    "POST",
    "/api/boards/copies",
    { token: maker, share, body: { on: true } },
    "Letting viewers make their own copy",
  );

  // Nobody else joins to change it; anyone with the view link looks.
  await must(
    "POST",
    "/api/boards/links",
    { token: maker, share, body: { kind: "edit", on: false } },
    "Turning the edit link off",
  );
  const kept =
    state.view === undefined
      ? null
      : await call("POST", "/api/guest/view", { body: { credential: state.view } });
  if (kept === null || !kept.ok) {
    if (state.view !== undefined)
      console.warn("The view link was off or replaced; making a new one.");
    state.view = (
      await must(
        "POST",
        "/api/boards/links",
        { token: maker, share, body: { kind: "view", on: true } },
        "Turning the view link on",
      )
    ).credential;
    saveState(state);
  }

  const link = new URL("/guest", args.app);
  link.searchParams.set("host", new URL(args.host).host);
  link.hash = state.view;
  console.log(`Sample board ${share} is ready (${sample.cards.length} cards).`);
  console.log(`State kept in ${args.state}`);
  console.log(`View link:\n${link.toString()}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
