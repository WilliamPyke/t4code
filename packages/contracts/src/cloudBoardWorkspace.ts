import * as Schema from "effect/Schema";

import { GuestShareId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { CLOUD_BOARD_ROUTE, GuestRedeemRequest, RoomBoardNoteColor } from "./guestShare.ts";
import { CloudBoardPreview } from "./cloudBoardAccount.ts";

/**
 * Workspaces: a team's shared place for cloud boards. Every route is signed with the account's
 * Clerk session token as the bearer, which the host verifies itself; the host checks membership
 * and role. People are named by `memberId`, never by their account.
 *
 * `GET` lists the account's workspaces with their people and boards; `POST` makes one.
 */
export const CLOUD_WORKSPACES_ROUTE = `${CLOUD_BOARD_ROUTE}/workspaces`;
/** `?workspace=`: `POST` renames or recolours (owner), `DELETE` deletes it (owner). */
export const CLOUD_WORKSPACE_ROUTE = `${CLOUD_WORKSPACES_ROUTE}/one`;
/** `?workspace=`: `POST` makes a new invite link, ending the old one; `DELETE` ends it (owner). */
export const CLOUD_WORKSPACE_INVITE_ROUTE = `${CLOUD_WORKSPACES_ROUTE}/invite`;
/** What an invite link is for, read without signing in. */
export const CLOUD_WORKSPACE_PREVIEW_ROUTE = `${CLOUD_WORKSPACES_ROUTE}/preview`;
export const CLOUD_WORKSPACE_JOIN_ROUTE = `${CLOUD_WORKSPACES_ROUTE}/join`;
/** `?workspace=&member=`: `POST` changes their role, `DELETE` removes them (owner). */
export const CLOUD_WORKSPACE_MEMBER_ROUTE = `${CLOUD_WORKSPACES_ROUTE}/members`;
/** `?workspace=`: the account leaves the workspace. */
export const CLOUD_WORKSPACE_LEAVE_ROUTE = `${CLOUD_WORKSPACES_ROUTE}/leave`;
/** `?workspace=&share=`: `POST` moves a board in (its maker), `DELETE` moves it out. */
export const CLOUD_WORKSPACE_BOARD_ROUTE = `${CLOUD_WORKSPACES_ROUTE}/boards`;
/** `?workspace=&share=`: a session on a workspace board, as the account's person on it. */
export const CLOUD_WORKSPACE_OPEN_ROUTE = `${CLOUD_WORKSPACES_ROUTE}/open`;

export const CLOUD_WORKSPACE_PARAM = "workspace";
export const CLOUD_WORKSPACE_MEMBER_PARAM = "member";

export const CLOUD_WORKSPACE_NAME_MAX_LENGTH = 60;
export const CLOUD_WORKSPACE_MAX_MEMBERS = 50;
export const CLOUD_WORKSPACE_MAX_BOARDS = 500;
/** As many workspaces as one account is in. */
export const CLOUD_WORKSPACES_PER_ACCOUNT = 50;

export const CloudWorkspaceRole = Schema.Literals(["owner", "member"]);
export type CloudWorkspaceRole = typeof CloudWorkspaceRole.Type;

const WorkspaceName = TrimmedNonEmptyString.check(
  Schema.isMaxLength(CLOUD_WORKSPACE_NAME_MAX_LENGTH),
);

/** How the account shows to others in a workspace: its name and picture, never its id. */
export const CloudWorkspaceProfile = Schema.Struct({
  name: GuestRedeemRequest.fields.name,
  imageUrl: Schema.optional(Schema.String.check(Schema.isMaxLength(512))),
});
export type CloudWorkspaceProfile = typeof CloudWorkspaceProfile.Type;

export const CloudWorkspaceMember = Schema.Struct({
  memberId: TrimmedNonEmptyString,
  name: Schema.String,
  imageUrl: Schema.optional(Schema.String),
  role: CloudWorkspaceRole,
  joinedAt: Schema.String,
  /** The account reading this. */
  you: Schema.optional(Schema.Boolean),
});
export type CloudWorkspaceMember = typeof CloudWorkspaceMember.Type;

export const CloudWorkspaceBoard = Schema.Struct({
  shareId: GuestShareId,
  threadId: ThreadId,
  title: Schema.String,
  addedAt: Schema.String,
  /** The member who put it in the workspace. */
  addedBy: Schema.optional(TrimmedNonEmptyString),
  /** A small map of its cards for its tile on the home, once the board has changed. */
  preview: Schema.optional(CloudBoardPreview),
});
export type CloudWorkspaceBoard = typeof CloudWorkspaceBoard.Type;

export const CloudWorkspace = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: Schema.String,
  color: RoomBoardNoteColor,
  /** The reader's role. */
  role: CloudWorkspaceRole,
  members: Schema.Array(CloudWorkspaceMember),
  boards: Schema.Array(CloudWorkspaceBoard),
  /** The invite link's code, while there is one. */
  invite: Schema.optional(TrimmedNonEmptyString),
  createdAt: Schema.String,
});
export type CloudWorkspace = typeof CloudWorkspace.Type;

export const CloudWorkspaceList = Schema.Struct({ workspaces: Schema.Array(CloudWorkspace) });
export type CloudWorkspaceList = typeof CloudWorkspaceList.Type;

export const CloudWorkspaceCreateRequest = Schema.Struct({
  name: WorkspaceName,
  color: RoomBoardNoteColor,
  profile: CloudWorkspaceProfile,
});
export type CloudWorkspaceCreateRequest = typeof CloudWorkspaceCreateRequest.Type;

export const CloudWorkspaceRenameRequest = Schema.Struct({
  name: Schema.optional(WorkspaceName),
  color: Schema.optional(RoomBoardNoteColor),
});
export type CloudWorkspaceRenameRequest = typeof CloudWorkspaceRenameRequest.Type;

export const CloudWorkspaceInviteResult = Schema.Struct({ invite: TrimmedNonEmptyString });
export type CloudWorkspaceInviteResult = typeof CloudWorkspaceInviteResult.Type;

export const CloudWorkspacePreviewRequest = Schema.Struct({
  code: TrimmedNonEmptyString.check(Schema.isMaxLength(256)),
});
export type CloudWorkspacePreviewRequest = typeof CloudWorkspacePreviewRequest.Type;

export const CloudWorkspacePreview = Schema.Struct({
  id: TrimmedNonEmptyString,
  name: Schema.String,
  color: RoomBoardNoteColor,
  members: Schema.Number,
  /** The name of the owner who has been in it longest, so the invite says whose it is. */
  owner: Schema.optional(Schema.String),
});
export type CloudWorkspacePreview = typeof CloudWorkspacePreview.Type;

export const CloudWorkspaceJoinRequest = Schema.Struct({
  code: CloudWorkspacePreviewRequest.fields.code,
  profile: CloudWorkspaceProfile,
});
export type CloudWorkspaceJoinRequest = typeof CloudWorkspaceJoinRequest.Type;

export const CloudWorkspaceRoleRequest = Schema.Struct({ role: CloudWorkspaceRole });
export type CloudWorkspaceRoleRequest = typeof CloudWorkspaceRoleRequest.Type;

/** Opening a workspace board for the first time seats the account under this name. */
export const CloudWorkspaceOpenRequest = Schema.Struct({ name: CloudWorkspaceProfile.fields.name });
export type CloudWorkspaceOpenRequest = typeof CloudWorkspaceOpenRequest.Type;
