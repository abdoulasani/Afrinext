import { index, inet, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity";

/**
 * Append-only record of every administrative action and every financial state
 * change. Written in the same transaction as the change it describes, so an
 * action cannot succeed unaudited.
 */
export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey(),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    actorKind: text("actor_kind").notNull(), // user | system | job
    action: text("action").notNull(), // ledger.post, session.revoke, role.grant …
    targetType: text("target_type"),
    targetId: text("target_id"),
    // Before/after are recorded for state changes; omitted for pure reads.
    before: jsonb("before"),
    after: jsonb("after"),
    context: jsonb("context").notNull().default({}), // request id, trace id
    ipAddress: inet("ip_address"),
    userAgent: text("user_agent"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("audit_logs_actor_idx").on(t.actorUserId),
    index("audit_logs_action_idx").on(t.action),
    index("audit_logs_target_idx").on(t.targetType, t.targetId),
    index("audit_logs_occurred_idx").on(t.occurredAt),
  ],
);
