// @effect-diagnostics globalDate:off cryptoRandomUUID:off - A plain Cloudflare object, outside the Effect runtime.
import type {
  CloudWorkspace,
  CloudWorkspaceBoard,
  CloudWorkspacePreview,
  CloudWorkspaceProfile,
  CloudWorkspaceRenameRequest,
  CloudWorkspaceRole,
  RoomBoardNoteColor,
} from "@t3tools/contracts";
import { DurableObject } from "cloudflare:workers";
import * as Result from "effect/Result";

import { roomFailure, type RoomFailure } from "./room.ts";
import { makeSecret } from "./secrets.ts";
import {
  checkAddBoard,
  createWorkspace,
  joinWorkspace,
  leaveWorkspace,
  memberOf,
  nextBoardWork,
  previewOf,
  removeMember,
  renameWorkspace,
  roleChangedItem,
  setMemberRole,
  withInvite,
  workspaceView,
  type WorkspaceMember,
  type WorkspaceState,
} from "./workspace.ts";
import type { Answer, WorkspaceEnv } from "./workspaceRoutes.ts";

const boardOf = (env: WorkspaceEnv, shareId: string) =>
  env.BOARDS.get(env.BOARDS.idFromName(shareId));
const indexOf = (env: WorkspaceEnv, account: string) =>
  env.ACCOUNTS.get(env.ACCOUNTS.idFromName(account));

const STATE_KEY = "workspace";
const BOARD_PREFIX = "board:";
const WORK_KEY = "work";
/** Boards told per step, so one request stays well inside Cloudflare's subrequest limit. */
const BOARDS_PER_STEP = 25;

/**
 * Work on the workspace's boards that runs in steps: taking someone's way in away on each, or
 * letting every board go once the workspace is deleted. `after` is the last board done.
 */
type BoardWork = {
  readonly workspaceId: string;
  readonly after?: string;
  /** Boards a step could not tell, asked again on their own. */
  readonly retry?: { readonly shareIds: ReadonlyArray<string>; readonly attempt: number };
} & ({ readonly kind: "lock"; readonly account: string } | { readonly kind: "release" });

/**
 * One workspace: its people and its list of boards. Only the Worker calls it, with an account it
 * verified; each method checks that account's membership and role itself.
 */
export class BoardWorkspace extends DurableObject<WorkspaceEnv> {
  private async state(): Promise<WorkspaceState | null> {
    return (await this.ctx.storage.get<WorkspaceState>(STATE_KEY)) ?? null;
  }

  private async boards(): Promise<ReadonlyArray<CloudWorkspaceBoard>> {
    const stored = await this.ctx.storage.list<CloudWorkspaceBoard>({ prefix: BOARD_PREFIX });
    return [...stored.values()];
  }

  private async keep(state: WorkspaceState): Promise<void> {
    await this.ctx.storage.put(STATE_KEY, state);
  }

  async create(input: {
    readonly id: string;
    readonly account: string;
    readonly name: string;
    readonly color: RoomBoardNoteColor;
    readonly profile: CloudWorkspaceProfile;
  }): Promise<Answer<CloudWorkspace>> {
    if ((await this.state()) !== null) return { failure: roomFailure("exists") };
    const state = createWorkspace({
      id: input.id,
      name: input.name,
      color: input.color,
      owner: { account: input.account, memberId: crypto.randomUUID(), profile: input.profile },
      invite: makeSecret(input.id),
      now: new Date().toISOString(),
    });
    await this.keep(state);
    return { value: workspaceView(state, [], input.account)! };
  }

  async read(account: string): Promise<CloudWorkspace | null> {
    const state = await this.state();
    return memberOf(state, account) === undefined
      ? null
      : workspaceView(state, await this.boards(), account);
  }

  async preview(code: string): Promise<CloudWorkspacePreview | null> {
    return previewOf(await this.state(), code);
  }

  async roleOf(account: string): Promise<CloudWorkspaceRole | null> {
    return memberOf(await this.state(), account)?.role ?? null;
  }

  /** Who a board of the workspace may `@` mention, by member id. */
  async memberIds(): Promise<ReadonlyArray<string>> {
    return (await this.state())?.members.map((member) => member.memberId) ?? [];
  }

  /** The accounts of these members, for a board putting a mention in their inbox. */
  async accountsOf(memberIds: ReadonlyArray<string>): Promise<Readonly<Record<string, string>>> {
    const members = (await this.state())?.members ?? [];
    return Object.fromEntries(
      members.flatMap((member) =>
        memberIds.includes(member.memberId) ? [[member.memberId, member.account]] : [],
      ),
    );
  }

  /** The owners' accounts, who answer requests for edit access to the workspace's boards. */
  async ownerAccounts(): Promise<ReadonlyArray<string>> {
    return (
      (await this.state())?.members.flatMap((member) =>
        member.role === "owner" ? [member.account] : [],
      ) ?? []
    );
  }

  async join(
    account: string,
    code: string,
    profile: CloudWorkspaceProfile,
  ): Promise<Answer<CloudWorkspace>> {
    const joined = joinWorkspace(await this.state(), {
      code,
      account,
      memberId: crypto.randomUUID(),
      profile,
      now: new Date().toISOString(),
    });
    if (Result.isFailure(joined)) return { failure: joined.failure };
    await this.keep(joined.success);
    return { value: workspaceView(joined.success, await this.boards(), account)! };
  }

  async rename(account: string, change: CloudWorkspaceRenameRequest): Promise<Answer<null>> {
    const renamed = renameWorkspace(await this.state(), account, change);
    if (Result.isFailure(renamed)) return { failure: renamed.failure };
    await this.keep(renamed.success);
    return { value: null };
  }

  /** A new invite link that ends the old one (`renew`), or no link. */
  async invite(account: string, renew: boolean): Promise<Answer<string | null>> {
    const state = await this.state();
    const code = renew && state !== null ? makeSecret(state.id) : null;
    const changed = withInvite(state, account, code);
    if (Result.isFailure(changed)) return { failure: changed.failure };
    await this.keep(changed.success);
    return { value: code };
  }

  async setRole(
    account: string,
    memberId: string,
    role: CloudWorkspaceRole,
  ): Promise<Answer<null>> {
    const before = await this.state();
    const changed = setMemberRole(before, account, memberId, role);
    if (Result.isFailure(changed)) return { failure: changed.failure };
    await this.keep(changed.success);
    const told = roleChangedItem(before, changed.success, {
      by: account,
      memberId,
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
    });
    if (told !== null) {
      await indexOf(this.env, told.account)
        .deliver([told.item])
        .catch(() => undefined);
    }
    return { value: null };
  }

  async removeMember(account: string, memberId: string): Promise<Answer<null>> {
    const removed = removeMember(await this.state(), account, memberId);
    if (Result.isFailure(removed)) return { failure: removed.failure };
    if (removed.success.removed !== null)
      await this.takeOut(removed.success.state, removed.success.removed);
    return { value: null };
  }

  async leave(account: string): Promise<Answer<null>> {
    const left = leaveWorkspace(await this.state(), account);
    if (Result.isFailure(left)) return { failure: left.failure };
    await this.takeOut(left.success.state, left.success.removed);
    return { value: null };
  }

  /** An owner deletes the workspace. Its boards stay, with everyone on them, outside any workspace. */
  async remove(account: string): Promise<Answer<null>> {
    const state = await this.state();
    const member = memberOf(state, account);
    if (state === null || member === undefined) return { failure: roomFailure("not_member") };
    if (member.role !== "owner") return { failure: roomFailure("not_owner") };
    await this.ctx.storage.delete(STATE_KEY);
    await this.queue({ kind: "release", workspaceId: state.id });
    return { value: null };
  }

  async checkAdd(account: string, shareId: string): Promise<RoomFailure | null> {
    const listed = (await this.ctx.storage.get(BOARD_PREFIX + shareId)) !== undefined;
    const count = listed ? 0 : (await this.ctx.storage.list({ prefix: BOARD_PREFIX })).size;
    return checkAddBoard(await this.state(), account, count, listed);
  }

  async addBoard(account: string, board: CloudWorkspaceBoard): Promise<void> {
    const state = await this.state();
    const member = memberOf(state, account);
    if (member === undefined) return;
    const listed = await this.ctx.storage.get<CloudWorkspaceBoard>(BOARD_PREFIX + board.shareId);
    await this.ctx.storage.put(
      BOARD_PREFIX + board.shareId,
      listed === undefined
        ? { ...board, addedBy: member.memberId }
        : {
            ...listed,
            title: board.title,
            ...(board.preview === undefined ? {} : { preview: board.preview }),
          },
    );
  }

  /** The board's new preview, from the board itself. */
  async setBoardPreview(shareId: string, preview: string): Promise<void> {
    const listed = await this.ctx.storage.get<CloudWorkspaceBoard>(BOARD_PREFIX + shareId);
    if (listed !== undefined && listed.preview !== preview) {
      await this.ctx.storage.put(BOARD_PREFIX + shareId, { ...listed, preview });
    }
  }

  async hasBoard(shareId: string): Promise<boolean> {
    return (await this.ctx.storage.get(BOARD_PREFIX + shareId)) !== undefined;
  }

  async forgetBoard(shareId: string): Promise<void> {
    await this.ctx.storage.delete(BOARD_PREFIX + shareId);
  }

  async retitleBoard(shareId: string, title: string): Promise<void> {
    const listed = await this.ctx.storage.get<CloudWorkspaceBoard>(BOARD_PREFIX + shareId);
    if (listed !== undefined && listed.title !== title) {
      await this.ctx.storage.put(BOARD_PREFIX + shareId, { ...listed, title });
    }
  }

  /** Keeps the workspace without `removed`, then takes their way in to its boards away. */
  private async takeOut(state: WorkspaceState, removed: WorkspaceMember): Promise<void> {
    await this.keep(state);
    await indexOf(this.env, removed.account)
      .forgetWorkspaces([state.id])
      .catch(() => undefined);
    await this.queue({ kind: "lock", account: removed.account, workspaceId: state.id });
  }

  private async queue(work: BoardWork): Promise<void> {
    const pending = (await this.ctx.storage.get<ReadonlyArray<BoardWork>>(WORK_KEY)) ?? [];
    await this.ctx.storage.put(WORK_KEY, [...pending, work]);
    await this.step();
  }

  override async alarm(): Promise<void> {
    await this.step();
  }

  /** Does one step of the oldest work, and comes back for the rest. */
  private async step(): Promise<void> {
    const [work, ...rest] = (await this.ctx.storage.get<ReadonlyArray<BoardWork>>(WORK_KEY)) ?? [];
    if (work === undefined) return;
    const boards =
      work.retry?.shareIds ??
      [
        ...(
          await this.ctx.storage.list<CloudWorkspaceBoard>({
            prefix: BOARD_PREFIX,
            ...(work.after === undefined ? {} : { startAfter: BOARD_PREFIX + work.after }),
            limit: BOARDS_PER_STEP,
          })
        ).values(),
      ].map((board) => board.shareId);
    // A board still unreached opens nothing new: the workspace is asked on every open.
    const told = await Promise.allSettled(
      boards.map((shareId) =>
        work.kind === "lock"
          ? boardOf(this.env, shareId).lockOut(work.account, work.workspaceId)
          : boardOf(this.env, shareId).leaveWorkspace(work.workspaceId),
      ),
    );
    const failed = boards.filter((_, index) => told[index]?.status === "rejected");
    const next = nextBoardWork(work, rest, boards, failed, BOARDS_PER_STEP);
    if (next.length > 0) {
      await this.ctx.storage.put(WORK_KEY, next);
      await this.ctx.storage.setAlarm(Date.now() + (failed.length > 0 ? 30_000 : 1_000));
      return;
    }
    if (work.kind === "release" && (await this.state()) === null) {
      await this.ctx.storage.deleteAll();
      return;
    }
    await this.ctx.storage.delete(WORK_KEY);
  }
}
