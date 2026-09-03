import { content } from "@afrinext/core";
import { getDb } from "@afrinext/db";
import { getContentKey, getContentStorage } from "@/lib/content";
import { requireActor, UnauthenticatedError } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * The only route that returns the bytes of a protected file.
 *
 * It requires a session AND a grant, and it re-checks the entitlement in SQL
 * before reading a single byte. The grant on its own is not an authority: the
 * actor is resolved from the cookie first, so a grant pasted into a browser
 * with no session never reaches the domain at all, and one pasted into somebody
 * else's session is refused on the subject check.
 *
 * Nothing here is cacheable and nothing here is guessable. The response says so
 * explicitly, because a shared cache holding a purchased PDF would hand it to
 * the next person through the same proxy.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  try {
    const actor = await requireActor();
    const { token } = await params;

    const opened = await content.openContent(
      getDb(),
      getContentStorage(),
      getContentKey(),
      actor,
      decodeURIComponent(token),
    );

    /*
     * The filename is derived from the asset's title, and stripped to a safe
     * shape. A title is seller-supplied text, and a quote or a newline in a
     * Content-Disposition header is a header-injection primitive.
     */
    const safeName = opened.title.replace(/[^A-Za-z0-9 ._-]/g, "").slice(0, 80) || "afrinext";

    return new Response(new Uint8Array(opened.object.bytes), {
      status: 200,
      headers: {
        "content-type": opened.object.contentType,
        "content-length": String(opened.object.bytes.byteLength),
        "content-disposition": `${opened.disposition}; filename="${safeName}"`,
        // Never store this anywhere but the reader's own memory.
        "cache-control": "private, no-store, max-age=0",
        // The bytes are seller-supplied. Nothing may sniff them into something
        // executable, and nothing may frame them.
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
        "referrer-policy": "no-referrer",
      },
    });
  } catch (error: unknown) {
    /*
     * Two answers, and the line between them is deliberate.
     *
     * No session at all is a 401: the caller already knows they are signed out,
     * so saying so leaks nothing and lets the client send them to sign in.
     * Every OTHER refusal — expired grant, wrong subject, no entitlement,
     * revoked, unpublished, no such asset — is the same 403 with the same
     * message, so an authenticated prober cannot tell which check stopped them.
     * The real reason is audited.
     */
    if (error instanceof UnauthenticatedError) {
      return new Response(
        JSON.stringify({ error: { code: "auth.required", message: "Authentication required." } }),
        { status: 401, headers: { "content-type": "application/json" } },
      );
    }
    /*
     * The third answer, and the only refusal allowed to be specific.
     *
     * A download limit is reached only by somebody who has ALREADY proved a
     * live entitlement to this exact file — the domain checks the entitlement
     * before it counts. Telling them they have used their allowance discloses
     * a fact about their own purchase, to them, and leaves them able to act on
     * it. A prober never sees this: they are stopped by the 403 above, one
     * check earlier, having proved nothing.
     *
     * 429 rather than 403 because the request was legitimate and the answer is
     * about exhaustion, not about permission.
     */
    if (error instanceof content.DownloadLimitReachedError) {
      return new Response(
        JSON.stringify({ error: { code: error.code, message: error.message } }),
        { status: 429, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(
      JSON.stringify({ error: { code: "content.forbidden", message: "You do not have access to this content." } }),
      { status: 403, headers: { "content-type": "application/json" } },
    );
  }
}
