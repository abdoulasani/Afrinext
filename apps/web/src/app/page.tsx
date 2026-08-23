import { redirect } from "next/navigation";

/**
 * The root sends people to a language.
 *
 * Every real screen lives under /fr or /en, so the bare origin is a redirect
 * rather than a third, untranslated copy of the marketplace. French first,
 * because the launch market is Niger.
 */
export default function RootPage(): never {
  redirect("/fr");
}
