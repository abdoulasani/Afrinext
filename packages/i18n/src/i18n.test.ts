import { describe, expect, it } from "vitest";
import en from "./messages/en.json";
import fr from "./messages/fr.json";
import { catalogues, DEFAULT_LOCALE, isLocale, LOCALES, resolveLocale, translate } from "./index";

/**
 * The catalogues and the plural machinery.
 *
 * Two things here would ship a visibly broken interface without being caught by
 * a typecheck: a key that exists in French and not in English, and "1 offre(s)"
 * — which is what a plural looks like when nobody implements one.
 */

describe("catalogue parity", () => {
  it("defines exactly the same keys in every locale", () => {
    const reference = new Set(Object.keys(fr));
    for (const locale of LOCALES) {
      const keys = new Set(Object.keys(catalogues[locale]));
      const missing = [...reference].filter((k) => !keys.has(k));
      const extra = [...keys].filter((k) => !reference.has(k));
      expect(missing, `${locale} is missing keys`).toEqual([]);
      expect(extra, `${locale} has keys French does not`).toEqual([]);
    }
  });

  it("never leaves a message empty", () => {
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(catalogues[locale])) {
        expect(value.trim(), `${locale}:${key} is blank`).not.toBe("");
      }
    }
  });

  it("uses the same placeholders in both languages", () => {
    const placeholders = (text: string): string[] =>
      [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1] ?? "").sort();

    for (const key of Object.keys(fr) as (keyof typeof fr)[]) {
      expect(placeholders(en[key]), `${key}: English placeholders differ`)
        .toEqual(placeholders(fr[key]));
    }
  });

  /*
   * A translator adding `foo#one` and forgetting `foo#other` would produce a
   * message that silently falls back to the base form for every count above
   * one — which is exactly the bug this whole mechanism exists to remove.
   */
  it("gives every pluralised key a complete set of forms", () => {
    for (const locale of LOCALES) {
      const keys = Object.keys(catalogues[locale]);
      for (const key of keys.filter((k) => k.endsWith("#one"))) {
        const base = key.slice(0, -"#one".length);
        expect(keys, `${locale}: ${base} has #one but no #other`).toContain(`${base}#other`);
        expect(keys, `${locale}: ${base} has variants but no base form`).toContain(base);
      }
    }
  });

  it("gives every pluralised message exactly one numeric placeholder to count", () => {
    for (const key of Object.keys(fr).filter((k) => k.endsWith("#one"))) {
      const base = key.slice(0, -"#one".length);
      const names = [...(fr[base as keyof typeof fr]).matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      expect(names.length, `${base} must interpolate exactly one value`).toBe(1);
    }
  });
});

describe("plurals", () => {
  it("says 'offre' for one and 'offres' for several, in French", () => {
    expect(translate("fr", "market.offeringCount", { count: 1 })).toBe("1 offre");
    expect(translate("fr", "market.offeringCount", { count: 2 })).toBe("2 offres");
  });

  /*
   * The interesting case, and the reason `Intl.PluralRules` is doing this
   * rather than `count === 1 ? a : b`: French puts zero in the SINGULAR and
   * English puts it in the plural. A hand-rolled ternary gets one of these
   * wrong whichever way it is written.
   */
  it("puts zero in the singular in French and the plural in English", () => {
    expect(translate("fr", "market.offeringCount", { count: 0 })).toBe("0 offre");
    expect(translate("en", "market.offeringCount", { count: 0 })).toBe("0 offerings");
  });

  it("pluralises on whichever value is the number, not on a variable named count", () => {
    expect(translate("fr", "auth.codeIncorrect", { attempts: 1 }))
      .toBe("Code incorrect. Il vous reste 1 tentative.");
    expect(translate("fr", "auth.codeIncorrect", { attempts: 3 }))
      .toBe("Code incorrect. Il vous reste 3 tentatives.");
  });

  it("leaves an unpluralised message exactly as written", () => {
    expect(translate("fr", "market.searchAction")).toBe("Rechercher");
    // A number in the values of a non-pluralised key changes nothing.
    expect(translate("fr", "store.memberSince", { date: "mars 2026" }))
      .toContain("mars 2026");
  });
});

describe("locale resolution", () => {
  it("defaults to French, the launch market's language", () => {
    expect(DEFAULT_LOCALE).toBe("fr");
    expect(resolveLocale(undefined)).toBe("fr");
    expect(resolveLocale("de")).toBe("fr");
  });

  it("accepts a region-tagged locale", () => {
    expect(resolveLocale("en-GB")).toBe("en");
    expect(resolveLocale("fr-NE")).toBe("fr");
  });

  it("recognises exactly the locales it ships", () => {
    expect(isLocale("fr")).toBe(true);
    expect(isLocale("en")).toBe(true);
    expect(isLocale("es")).toBe(false);
  });
});

describe("missing keys", () => {
  it("returns the key itself, so the gap is visible rather than blank", () => {
    // Deliberately outside MessageKey: this is the shape of a typo surviving
    // into production, and a blank string on screen would hide it.
    expect(translate("fr", "not.a.real.key" as never)).toBe("not.a.real.key");
  });

  it("leaves an unsupplied placeholder in place rather than printing 'undefined'", () => {
    expect(translate("fr", "market.offeringCount", {})).toBe("{count} offres");
  });
});
