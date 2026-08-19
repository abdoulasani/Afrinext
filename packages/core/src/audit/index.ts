import type { Database } from "@afrinext/db";
import { schema } from "@afrinext/db";
import { uuidv7 } from "../ids";

export interface AuditEntry {
  readonly actorUserId?: string | undefined;
  readonly actorKind: "user" | "system" | "job";
  readonly action: string;
  readonly targetType?: string | undefined;
  readonly targetId?: string | undefined;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly context?: Readonly<Record<string, unknown>> | undefined;
  readonly ipAddress?: string | undefined;
  readonly userAgent?: string | undefined;
}

/**
 * Writes an audit record.
 *
 * Pass the same transaction handle as the change being audited so the two
 * commit together — an action that succeeds without its audit row is exactly
 * the case an audit log exists to prevent.
 */
export async function audit(db: Database, entry: AuditEntry): Promise<string> {
  const id = uuidv7();
  await db.insert(schema.auditLogs).values({
    id,
    actorKind: entry.actorKind,
    action: entry.action,
    context: (entry.context ?? {}) as Record<string, unknown>,
    ...(entry.actorUserId !== undefined ? { actorUserId: entry.actorUserId } : {}),
    ...(entry.targetType !== undefined ? { targetType: entry.targetType } : {}),
    ...(entry.targetId !== undefined ? { targetId: entry.targetId } : {}),
    ...(entry.before !== undefined ? { before: entry.before } : {}),
    ...(entry.after !== undefined ? { after: entry.after } : {}),
    ...(entry.ipAddress !== undefined ? { ipAddress: entry.ipAddress } : {}),
    ...(entry.userAgent !== undefined ? { userAgent: entry.userAgent } : {}),
  });
  return id;
}
