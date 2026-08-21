import { sql } from "drizzle-orm";
import type { Database } from "@afrinext/db";
import { uuidv7 } from "../ids";

/**
 * The notification outbox: a queue of things a person should be told.
 *
 * NOTHING HERE SENDS ANYTHING. No SMS provider has been chosen for Niger — a
 * provider is selected only after a real handset delivery test on Airtel,
 * Orange and Moov, see docs/providers/sms/README.md — and inventing one to make
 * this look finished would be a lie with a buyer's money attached.
 *
 * What this is instead: the domain's stopping point. A refund resolves, and the
 * domain writes a ROW saying "this person should learn this". Whichever
 * provider is eventually chosen becomes a reader of this table rather than a
 * redesign of the refund path, and until then the rows accumulate visibly
 * rather than the intention being lost.
 *
 * Why a table and not a call to `MessageSender`:
 *
 *   - A send inside the resolving transaction either blocks the transaction on
 *     a third party, or commits money state and then loses the message.
 *   - A send after the transaction is a message that never happens if the
 *     process dies in between.
 *   - An outbox row written IN the transaction commits with the fact it
 *     describes. Either both happened or neither did.
 *
 * The payload holds facts, never a rendered message and never anything a log
 * should not contain. Translation and formatting belong to the sender, which
 * knows the recipient's locale; the domain knows the amount and the reference.
 */

export const NOTIFICATION_KINDS = [
  "refund.succeeded",
  "refund.failed",
  "refund.in_doubt",
  "refund.owed",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export interface QueueNotificationInput {
  readonly kind: NotificationKind;
  readonly recipientUserId: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly payload?: Readonly<Record<string, string | number | boolean | null>> | undefined;
}

/**
 * Queues one notification, idempotently.
 *
 * `on conflict do nothing` against UNIQUE (kind, subject_type, subject_id): a
 * resolution that runs twice — a retried request, a replayed webhook, a
 * scheduler and an operator arriving together — tells the buyer once. Being
 * told twice that your money is on its way is not harmful, but a queue that
 * grows a row per retry is a queue nobody can read.
 *
 * Pass the transaction handle that is making the change being announced, so the
 * two commit together.
 */
export async function queueNotification(
  db: Database,
  input: QueueNotificationInput,
): Promise<boolean> {
  const result = await db.execute(sql`
    insert into notification_outbox
      (id, kind, recipient_user_id, subject_type, subject_id, payload, status)
    values (${uuidv7()}, ${input.kind}, ${input.recipientUserId}::uuid,
            ${input.subjectType}, ${input.subjectId}::uuid,
            ${JSON.stringify(input.payload ?? {})}::jsonb, 'pending')
    on conflict (kind, subject_type, subject_id) do nothing
  `);
  return (result.rowCount ?? 0) > 0;
}

export interface PendingNotification {
  readonly id: string;
  readonly kind: string;
  readonly recipientUserId: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly payload: Record<string, unknown>;
  readonly createdAt: Date;
}

/**
 * What is waiting to be delivered.
 *
 * Read-only, and there is deliberately no `markSent` in this phase: nothing
 * delivers, so nothing may claim to have delivered. A function that moved rows
 * to `sent` without a provider behind it would put a lie in the database, and
 * "the buyer was notified" is exactly the kind of lie that surfaces during a
 * dispute.
 */
export async function pendingNotifications(
  db: Database,
  limit = 50,
): Promise<readonly PendingNotification[]> {
  const rows = await db.execute<{
    [key: string]: unknown;
    id: string;
    kind: string;
    recipient_user_id: string;
    subject_type: string;
    subject_id: string;
    payload: Record<string, unknown>;
    created_at: Date | string;
  }>(sql`
    select id, kind, recipient_user_id, subject_type, subject_id, payload, created_at
      from notification_outbox
     where status = 'pending'
     order by created_at
     limit ${Math.min(Math.max(Math.floor(limit), 1), 500)}
  `);

  return rows.rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    recipientUserId: r.recipient_user_id,
    subjectType: r.subject_type,
    subjectId: r.subject_id,
    payload: r.payload,
    createdAt: r.created_at instanceof Date ? r.created_at : new Date(r.created_at),
  }));
}
