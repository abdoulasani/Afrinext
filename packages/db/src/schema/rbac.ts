import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity";

export const permissions = pgTable("permissions", {
  // resource.action — 'product.publish', 'withdrawal.approve', 'lesson.view'
  key: text("key").primaryKey(),
  description: text("description").notNull(),
});

export const roles = pgTable(
  "roles",
  {
    id: uuid("id").primaryKey(),
    key: text("key").notNull(),
    description: text("description").notNull(),
    // Which scope this role is granted against. A role is meaningless without one.
    scopeType: text("scope_type").notNull(), // global | store | course | zone
    isAssignable: text("is_assignable").notNull().default("true"),
  },
  (t) => [
    uniqueIndex("roles_key_key").on(t.key),
    check("roles_scope_type_valid", sql`${t.scopeType} in ('global','store','course','zone')`),
  ],
);

export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
    permissionKey: text("permission_key").notNull().references(() => permissions.key, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("role_permissions_key").on(t.roleId, t.permissionKey)],
);

/**
 * Roles are scoped rows, never a column on the user. One person being a buyer,
 * an instructor, a rider in Niamey and staff on someone else's store at the
 * same time is the normal case, and costs nothing here.
 *
 * scopeId is NULL exactly when the role's scopeType is 'global'.
 */
export const roleAssignments = pgTable(
  "role_assignments",
  {
    id: uuid("id").primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
    scopeType: text("scope_type").notNull(),
    scopeId: uuid("scope_id"),
    grantedBy: uuid("granted_by").references(() => users.id),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    index("role_assignments_user_idx").on(t.userId),
    index("role_assignments_scope_idx").on(t.scopeType, t.scopeId),
    check(
      "role_assignments_scope_id_matches_type",
      sql`(${t.scopeType} = 'global' and ${t.scopeId} is null) or (${t.scopeType} <> 'global' and ${t.scopeId} is not null)`,
    ),
  ],
);
