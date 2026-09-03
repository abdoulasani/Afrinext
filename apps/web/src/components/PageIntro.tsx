import type { ReactNode } from "react";

/**
 * How an internal screen announces itself.
 *
 * Before this, every signed-in screen invented its own opening. The library
 * used a sticky `AppHeader` and nothing else, the orders page an uppercase
 * 12px label, the wallet a different uppercase label at a different size, the
 * seller area an 18px heading. Four screens, four grammars — and that
 * inconsistency is most of what makes an application feel assembled rather
 * than designed, because a person moving between tabs re-learns the layout
 * each time.
 *
 * One shape now: a copper eyebrow naming the area, the page's `<h1>`, an
 * optional sentence, and an optional action on the right. It sits on the sand
 * ground rather than in a bar, so the page begins with type instead of chrome
 * — which is also what lets the eye reach the content in one step.
 *
 * The eyebrow is decorative-adjacent but not decoration: it is the tab you are
 * in, which is the one thing a full-screen mobile view otherwise loses.
 */
export function PageIntro({
  eyebrow, title, body, action, className = "",
}: {
  eyebrow?: string;
  title: string;
  body?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={"px-4 sm:px-6 " + className}
      style={{ paddingTop: "calc(1.75rem + env(safe-area-inset-top))" }}
    >
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          {eyebrow !== undefined && (
            <p className="text-label uppercase text-copper">{eyebrow}</p>
          )}
          <h1 className="mt-1.5 text-h1 text-foreground">{title}</h1>
          {body !== undefined && (
            <p className="mt-2 max-w-[54ch] text-small text-muted">{body}</p>
          )}
        </div>
        {action !== undefined && <div className="shrink-0 pb-1">{action}</div>}
      </div>
    </header>
  );
}
