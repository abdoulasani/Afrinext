/**
 * The permission catalogue. Permissions are `resource.action` strings, seeded
 * into the permissions table so the database can reference them and the admin
 * console can list them.
 *
 * Phase 0 seeds only what Phase 0 and the immediately following phases need.
 * Adding a permission is a migration plus a row, never a code branch.
 */
export const PERMISSIONS = {
  "profile.read": "Read one's own profile",
  "profile.update": "Update one's own profile",
  "session.revoke_own": "Sign out of one's own sessions",

  "store.create": "Create a store",
  "store.update": "Update a store's details",
  "store.read_analytics": "View a store's analytics",

  "product.create": "Create a product in a store",
  "product.publish": "Publish a product",

  "course.create": "Create a course",
  "course.publish": "Publish a course",
  "lesson.view": "View a paid lesson's content",

  "order.refund": "Refund an order",

  "wallet.read_own": "View one's own wallet and transactions",
  "withdrawal.request": "Request a withdrawal of one's own funds",
  "withdrawal.approve": "Approve someone else's withdrawal",

  "ledger.read": "Read the ledger",
  "ledger.adjust": "Post a manual ledger adjustment",

  "admin.user.read": "Read any user",
  "admin.user.suspend": "Suspend a user",
  "admin.role.grant": "Grant or revoke roles",
  "admin.settings.update": "Change platform settings",
  "admin.audit.read": "Read the audit log",
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export type ScopeType = "global" | "store" | "course" | "zone";

/**
 * The seeded roles. Administrative capability is split so that no single role
 * can both move money and change who is allowed to move money.
 */
export const ROLE_DEFINITIONS: ReadonlyArray<{
  key: string;
  scopeType: ScopeType;
  description: string;
  permissions: readonly Permission[];
}> = [
  {
    key: "member",
    scopeType: "global",
    description: "Every signed-in user. Buying requires nothing more than this.",
    permissions: ["profile.read", "profile.update", "session.revoke_own", "wallet.read_own", "withdrawal.request"],
  },
  {
    key: "store_owner",
    scopeType: "store",
    description: "Owns a store and everything published under it.",
    permissions: ["store.update", "store.read_analytics", "product.create", "product.publish", "course.create", "course.publish"],
  },
  {
    key: "instructor",
    scopeType: "course",
    description: "Authors and maintains a course.",
    permissions: ["course.create", "course.publish"],
  },
  {
    key: "support",
    scopeType: "global",
    description: "Reads users and orders to help them. Cannot touch money.",
    permissions: ["admin.user.read", "ledger.read"],
  },
  {
    key: "ops",
    scopeType: "global",
    description: "Moderates the catalogue. No financial capability.",
    permissions: ["admin.user.read", "product.publish", "course.publish"],
  },
  {
    key: "finance",
    scopeType: "global",
    description: "Approves payouts and issues refunds. Cannot change permissions.",
    permissions: ["ledger.read", "ledger.adjust", "withdrawal.approve", "order.refund", "admin.user.read"],
  },
  {
    key: "superadmin",
    scopeType: "global",
    description: "Administers roles and settings. Deliberately holds no withdrawal.approve.",
    permissions: ["admin.user.read", "admin.user.suspend", "admin.role.grant", "admin.settings.update", "admin.audit.read", "ledger.read"],
  },
];
