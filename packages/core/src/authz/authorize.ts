import { and, eq, isNull, or } from "drizzle-orm";
import type { Database } from "@afrinext/db";
import { schema } from "@afrinext/db";
import { PermissionDeniedError } from "../errors";
import type { Permission, ScopeType } from "./permissions";

export interface Scope {
  readonly type: ScopeType;
  readonly id?: string | undefined;
}

export interface Actor {
  readonly userId: string;
  readonly sessionId?: string | undefined;
  /** True when the session was re-verified recently for a sensitive action. */
  readonly elevated?: boolean | undefined;
}

export const GLOBAL: Scope = { type: "global" };

function describe(scope: Scope): string {
  return scope.id === undefined ? scope.type : `${scope.type}:${scope.id}`;
}

/**
 * The single permission gate.
 *
 * Every route handler, server action and job calls this; nothing makes its own
 * decision. A global grant satisfies a scoped check — a `finance` role granted
 * globally can approve a withdrawal anywhere — but a scoped grant never
 * satisfies a check in a different scope.
 */
export async function can(
  db: Database,
  actor: Actor,
  permission: Permission,
  scope: Scope = { type: "global" },
): Promise<boolean> {
  const scopeMatches =
    scope.id === undefined
      ? and(eq(schema.roleAssignments.scopeType, "global"), isNull(schema.roleAssignments.scopeId))
      : or(
          and(eq(schema.roleAssignments.scopeType, "global"), isNull(schema.roleAssignments.scopeId)),
          and(
            eq(schema.roleAssignments.scopeType, scope.type),
            eq(schema.roleAssignments.scopeId, scope.id),
          ),
        );

  const rows = await db
    .select({ permissionKey: schema.rolePermissions.permissionKey })
    .from(schema.roleAssignments)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.roleAssignments.roleId))
    .innerJoin(schema.rolePermissions, eq(schema.rolePermissions.roleId, schema.roles.id))
    .where(
      and(
        eq(schema.roleAssignments.userId, actor.userId),
        isNull(schema.roleAssignments.revokedAt),
        eq(schema.rolePermissions.permissionKey, permission),
        scopeMatches,
      ),
    )
    .limit(1);

  return rows.length > 0;
}

/** Throws rather than returning false, so a forgotten check cannot pass silently. */
export async function authorize(
  db: Database,
  actor: Actor,
  permission: Permission,
  scope: Scope = { type: "global" },
): Promise<void> {
  if (!(await can(db, actor, permission, scope))) {
    throw new PermissionDeniedError(permission, describe(scope));
  }
}

/**
 * Separation of duty: nobody approves their own withdrawal, whatever roles
 * they hold. Enforced in code because a permission system alone cannot express
 * "except when the subject is yourself".
 */
export async function authorizeWithdrawalApproval(
  db: Database,
  actor: Actor,
  beneficiaryUserId: string,
): Promise<void> {
  if (actor.userId === beneficiaryUserId) {
    throw new PermissionDeniedError(
      "withdrawal.approve",
      "own withdrawal — a user may never approve a payout to themselves",
    );
  }
  await authorize(db, actor, "withdrawal.approve");
}

/** All permissions an actor holds in a scope. For rendering a UI, not for gating. */
export async function permissionsFor(
  db: Database,
  actor: Actor,
  scope: Scope = { type: "global" },
): Promise<string[]> {
  const scopeMatches =
    scope.id === undefined
      ? and(eq(schema.roleAssignments.scopeType, "global"), isNull(schema.roleAssignments.scopeId))
      : or(
          and(eq(schema.roleAssignments.scopeType, "global"), isNull(schema.roleAssignments.scopeId)),
          and(
            eq(schema.roleAssignments.scopeType, scope.type),
            eq(schema.roleAssignments.scopeId, scope.id),
          ),
        );

  const rows = await db
    .selectDistinct({ permissionKey: schema.rolePermissions.permissionKey })
    .from(schema.roleAssignments)
    .innerJoin(schema.roles, eq(schema.roles.id, schema.roleAssignments.roleId))
    .innerJoin(schema.rolePermissions, eq(schema.rolePermissions.roleId, schema.roles.id))
    .where(
      and(
        eq(schema.roleAssignments.userId, actor.userId),
        isNull(schema.roleAssignments.revokedAt),
        scopeMatches,
      ),
    );

  return rows.map((r) => r.permissionKey);
}
