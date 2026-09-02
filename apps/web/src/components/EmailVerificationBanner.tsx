"use client";

import Link from "next/link";
import type { Route } from "next";
import { useState } from "react";

/**
 * A quiet line at the top of the app, and deliberately nothing more.
 *
 * Verification is a trust signal Afrinext records. It is NOT the consent gate
 * (`users.status`, unchanged by any of this) and it is NOT account activation.
 * The dashboard, the wallet and every screen behind it are reachable without
 * it, on purpose — so this is a banner, not an interstitial, and it can be
 * dismissed for the session without anything asking again on the next click.
 *
 * The dismissal is local state, not a stored preference: it lasts as long as
 * this page does. A stored "never show me this" would be a setting nobody
 * remembers changing, hiding a thing the person does still need to do.
 */
export function EmailVerificationBanner({
  email, message, action, dismiss, href,
}: {
  email: string;
  message: string;
  action: string;
  dismiss: string;
  href: string;
}) {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;

  return (
    <div
      data-testid="email-unverified-banner"
      className={
        "border-b border-[var(--info)]/20 bg-[var(--info-soft)] " +
        "px-4 py-2.5 sm:px-6"
      }
      style={{ paddingTop: "calc(0.625rem + env(safe-area-inset-top))" }}
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-1.5">
        <p className="min-w-0 flex-1 text-caption text-[var(--info)]">
          {message.replace("{email}", email)}
        </p>
        <Link
          href={href as Route}
          data-testid="email-verify-link"
          className="shrink-0 text-caption font-semibold text-[var(--info)] underline underline-offset-2"
        >
          {action}
        </Link>
        <button
          type="button"
          onClick={() => { setHidden(true); }}
          className="shrink-0 rounded-[var(--radius-sm)] px-1.5 py-0.5 text-caption text-[var(--info)]/70 hover:text-[var(--info)]"
        >
          {dismiss}
        </button>
      </div>
    </div>
  );
}
