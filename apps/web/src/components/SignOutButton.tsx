"use client";

import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useState } from "react";
import { icons } from "./icons";
import { signOut } from "@/lib/auth-client";

/**
 * Sign out, server-side.
 *
 * Better Auth deletes the `session` row — the only session store there is — so
 * the token is dead for anyone holding it the moment this returns, not merely
 * missing from this browser. `router.refresh()` afterwards is what makes the
 * server components re-render as a signed-out person; without it the drawer
 * would still be showing the account section from the last render.
 *
 * Shaped like the drawer's links rather than like a button because it sits in
 * the same list, and a person reading that list should not have to work out
 * which item behaves differently.
 */
export function SignOutButton({ label, locale }: { label: string; locale: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      data-testid="sign-out"
      onClick={() => {
        setBusy(true);
        void signOut().then(() => {
          router.push(`/${locale}` as Route);
          router.refresh();
        }).finally(() => { setBusy(false); });
      }}
      className={
        "flex min-h-11 w-full items-center gap-3 rounded-[var(--radius-md)] px-3 py-2.5 " +
        "text-body text-foreground transition-colors duration-[var(--duration-fast)] " +
        "hover:bg-surface-muted active:scale-[0.99] disabled:opacity-60"
      }
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-surface-muted text-muted">
        {icons.profile}
      </span>
      {label}
    </button>
  );
}
