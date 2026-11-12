import { guestEnvironmentId } from "@t3tools/client-runtime/environment";
import {
  GUEST_COMMAND_OUTPUT_ROUTE,
  GuestId,
  GuestShareId,
  MessageId,
  type OrchestrationV2ThreadProjection,
  ProviderInstanceId,
  RunId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import { describe, expect, it, vi } from "vite-plus/test";

import "~/index.css";

import { render } from "../../../test/render";
import { forgetGuestShare, guestRoomAtom, rememberGuestShare } from "../../guest/guestShares";
import { AppAtomRegistryProvider, appAtomRegistry } from "../../rpc/atomRegistry";
import { makeThreadProjectionFixture } from "../../test-fixtures";
import { SidebarProvider } from "../ui/sidebar";
import { GuestThreadRoute } from "./GuestThreadView";

const thread = vi.hoisted(() => ({ state: null as unknown }));
vi.mock(import("~/state/threads"), async (original) => ({
  ...(await original()),
  useEnvironmentThread: (() => thread.state) as never,
}));

const SHARE_ID = "share-1";
const THREAD_ID = ThreadId.make("thread-test");
const RUN_ID = RunId.make("run-1");
const STARTED_AT = DateTime.makeUnsafe("2026-09-20T12:00:00Z");
const PROVIDER = ProviderInstanceId.make("shared");

/** One settled turn: a prompt, an edit, a command, a search, and the answer. */
function settledTurn(): OrchestrationV2ThreadProjection {
  const base = (id: string, ordinal: number) => ({
    id: TurnItemId.make(id),
    threadId: THREAD_ID,
    runId: RUN_ID,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal,
    status: "completed" as const,
    title: null,
    startedAt: STARTED_AT,
    completedAt: STARTED_AT,
    updatedAt: STARTED_AT,
  });
  const items: OrchestrationV2ThreadProjection["turnItems"] = [
    {
      ...base("user", 0),
      type: "user_message",
      messageId: MessageId.make("user"),
      createdBy: "user",
      creationSource: "web",
      inputIntent: "turn_start",
      text: "Build it",
      attachments: [],
    },
    { ...base("edit", 1), type: "file_change", fileName: "proj/src/a.ts", additions: 1 },
    { ...base("command", 2), type: "command_execution", input: "ls src", outputOmitted: true },
    { ...base("search", 3), type: "file_search", pattern: "needle" },
    {
      ...base("answer", 4),
      type: "assistant_message",
      messageId: MessageId.make("answer"),
      text: "Done",
      streaming: false,
    },
  ];
  return {
    ...makeThreadProjectionFixture(),
    turnItems: items,
    visibleTurnItems: items.map((item, position) => ({
      position,
      visibility: "local",
      sourceThreadId: THREAD_ID,
      sourceItemId: item.id,
      item,
    })),
    runs: [
      {
        id: RUN_ID,
        threadId: THREAD_ID,
        ordinal: 1,
        providerInstanceId: PROVIDER,
        modelSelection: { instanceId: PROVIDER, model: "gpt-5.4" },
        providerThreadId: null,
        userMessageId: MessageId.make("user"),
        rootNodeId: null,
        activeAttemptId: null,
        status: "completed",
        requestedAt: STARTED_AT,
        startedAt: STARTED_AT,
        completedAt: DateTime.makeUnsafe("2026-09-20T12:00:19Z"),
        checkpointId: null,
        contextHandoffId: null,
      },
    ],
  };
}

function setup(): Disposable {
  thread.state = {
    data: Option.some(settledTurn()),
    status: "live",
    error: Option.none(),
    history: { hasMoreHistory: false, loading: false, error: null },
    sequence: 1,
  };
  rememberGuestShare({
    host: "sam.t3.codes",
    shareId: SHARE_ID,
    threadId: THREAD_ID,
    token: "guest-token",
    title: "Thread",
    joinedAt: "2026-09-20T12:00:00.000Z",
  });
  const guestId = GuestId.make("guest-1");
  appAtomRegistry.set(guestRoomAtom(SHARE_ID), {
    online: [guestId],
    running: [],
    view: {
      shareId: GuestShareId.make(SHARE_ID),
      title: "Thread",
      guestName: "Sam",
      guestId,
      guests: [],
      direct: false,
      expiresAt: "2026-09-21T12:00:00.000Z",
      messages: [],
      model: { driver: null, name: "gpt-5.4" },
    },
  });
  return {
    [Symbol.dispose]: () => {
      forgetGuestShare(SHARE_ID);
      appAtomRegistry.set(guestRoomAtom(SHARE_ID), { online: [], view: null, running: [] });
    },
  };
}

describe("GuestThreadRoute", () => {
  it("opens a work group to its rows, and reads a row's detail through the guest routes", async () => {
    using _share = setup();
    using fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response(null, { status: 404 }));
    await using screen = await render(
      <AppAtomRegistryProvider>
        <SidebarProvider>
          <GuestThreadRoute
            threadRef={{ environmentId: guestEnvironmentId(SHARE_ID), threadId: THREAD_ID }}
          />
        </SidebarProvider>
      </AppAtomRegistryProvider>,
    );

    await screen.getByRole("button", { name: /^Worked for/ }).click();
    await screen.getByRole("button", { name: /^Changed 1 file, ran 1 command/ }).click();
    const rows = screen.getByRole("region", { name: "Tool calls" });
    await expect.element(rows.getByRole("button", { name: "proj/src/a.ts" })).toBeVisible();
    await expect.element(rows.getByRole("button", { name: "Searched needle" })).toBeVisible();

    await rows.getByRole("button", { name: "ls src" }).click();
    await vi.waitFor(() =>
      expect(fetchSpy.mock.calls.map(([url]) => String(url))).toContainEqual(
        expect.stringMatching(
          new RegExp(`^https://sam\\.t3\\.codes${GUEST_COMMAND_OUTPUT_ROUTE}\\?.*item=command`),
        ),
      ),
    );
  });
});
