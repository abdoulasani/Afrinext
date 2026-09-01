"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { icons } from "./icons";

export type MenuLink = { href: string; label: string; icon: keyof typeof icons };
export type MenuSection = { title: string; links: readonly MenuLink[] };

/**
 * The drawer behind the fifth tab.
 *
 * ---------------------------------------------------------------------------
 * Why a drawer at all, when there is already a tab bar
 * ---------------------------------------------------------------------------
 *
 * A phone tab bar holds five destinations before the labels start truncating,
 * and Afrinext has more than five places worth going. The reference apps solve
 * this the same way: four real destinations plus a "Menu" that opens
 * everything else. That keeps the bar honest — every tab in it is a place, not
 * a category — and gives the remaining screens somewhere to live that is not a
 * shortcut grid the person has to scroll home to reach.
 *
 * ---------------------------------------------------------------------------
 * What it will not do
 * ---------------------------------------------------------------------------
 *
 * The sections it shows are passed in by the server, which has already asked
 * `authorize()` what this actor may do. This component renders links; it never
 * decides who may see one. A seller section absent from `sections` is absent
 * because the permission check said so, and there is no client-side flag here
 * that could be flipped to bring it back.
 */
export function AppMenu({
  label, title, sections, footer, closeLabel,
}: {
  /** The trigger's accessible name, and the tab's visible word. */
  label: string;
  title: string;
  sections: readonly MenuSection[];
  footer?: readonly MenuLink[];
  closeLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  /*
   * Closing on navigation is done by the links themselves, not by an effect
   * watching the path. Setting state from an effect that fires on every route
   * change costs a second render of the whole sheet for a value the click
   * already knew — and while the sheet is open it covers the page, so a link
   * inside it is the only thing that can navigate.
   */
  const close = (): void => { setOpen(false); };

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") { close(); trigger.current?.focus(); }
    };
    document.addEventListener("keydown", onKey);
    // The page behind must not scroll while a full-height sheet is over it.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panel.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open]);

  const item = (link: MenuLink) => (
    <li key={link.href}>
      <Link
        href={link.href as Route}
        onClick={close}
        className={
          "flex min-h-11 items-center gap-3 rounded-[var(--radius-md)] px-3 py-2.5 " +
          "text-body text-foreground transition-colors duration-[var(--duration-fast)] " +
          "hover:bg-surface-muted active:scale-[0.99]"
        }
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] bg-surface-muted text-muted">
          {icons[link.icon]}
        </span>
        {link.label}
      </Link>
    </li>
  );

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={() => { setOpen(true); }}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-testid="open-menu"
        className={
          "group relative flex h-[58px] w-full flex-col items-center justify-center gap-1 " +
          "text-faint transition-colors duration-[var(--duration-fast)] " +
          "hover:text-foreground active:scale-[0.94] active:duration-[80ms]"
        }
      >
        {icons.menu}
        <span className="text-[10px] font-medium leading-none tracking-[0.01em]">{label}</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label={closeLabel}
            onClick={close}
            className="absolute inset-0 bg-[rgba(20,17,16,0.45)] backdrop-blur-[2px]"
          />
          <div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            tabIndex={-1}
            className={
              "absolute inset-x-0 bottom-0 max-h-[86vh] overflow-y-auto rounded-t-[var(--radius-xl)] " +
              "bg-surface pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-[var(--shadow-lg)] " +
              "outline-none motion-safe:animate-[afx-rise_var(--duration-base)_var(--ease-out)]"
            }
          >
            {/* The grab handle: says "this sheet moves" before anyone tries. */}
            <div className="sticky top-0 z-10 flex items-center justify-between gap-3 bg-surface px-5 pb-3 pt-4">
              <span aria-hidden="true" className="absolute inset-x-0 top-2 mx-auto h-1 w-9 rounded-full bg-border-strong" />
              <h2 className="mt-2 text-h2 text-foreground">{title}</h2>
              <button
                type="button"
                onClick={close}
                className={
                  "mt-2 flex h-11 w-11 items-center justify-center rounded-[var(--radius-pill)] " +
                  "text-muted transition-colors hover:bg-surface-muted hover:text-foreground"
                }
              >
                <span className="sr-only">{closeLabel}</span>
                {icons.close}
              </button>
            </div>

            <div className="flex flex-col gap-6 px-5 pt-1">
              {sections.map((section) => (
                <section key={section.title}>
                  <h3 className="px-3 text-label uppercase text-faint">{section.title}</h3>
                  <ul className="mt-2 flex flex-col gap-0.5">{section.links.map(item)}</ul>
                </section>
              ))}
              {footer !== undefined && footer.length > 0 && (
                <ul className="flex flex-col gap-0.5 border-t border-border pt-4">
                  {footer.map(item)}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
