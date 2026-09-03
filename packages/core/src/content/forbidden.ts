import { DomainError } from "../errors";

/**
 * The single refusal every content path answers with.
 *
 * "No such asset", "not yours", "expired grant", "revoked entitlement" and
 * "that product is not published" are one message on purpose, so the endpoint
 * cannot be used to learn which asset ids exist or which products somebody else
 * owns. The real reason goes to the audit log.
 *
 * It lives in its own module because both `access` and `versions` raise it, and
 * a cycle between those two would be a fragile way to share one class.
 */
export class ContentForbiddenError extends DomainError {
  override readonly name = "ContentForbiddenError";
  constructor() {
    super("content.forbidden", "You do not have access to this content.");
  }
}
