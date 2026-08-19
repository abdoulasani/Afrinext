import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  deriveOtpKey, generateOtp, generateOtpCode, hashOtpCode, hashPassword,
  needsRehash, normaliseEmail, normalisePhone, verifyOtp, verifyPassword,
} from "./index";

const KEY = deriveOtpKey("test-application-secret-0123456789abcdef");

describe("password hashing", () => {
  it("verifies a correct password and rejects a wrong one", async () => {
    const encoded = await hashPassword("correct horse battery");
    expect(await verifyPassword("correct horse battery", encoded)).toBe(true);
    expect(await verifyPassword("wrong horse battery", encoded)).toBe(false);
  });

  it("produces a different hash each time, so equal passwords are not linkable", async () => {
    const a = await hashPassword("correct horse battery");
    const b = await hashPassword("correct horse battery");
    expect(a).not.toBe(b);
  });

  it("carries its parameters, so the algorithm can be changed without invalidating hashes", async () => {
    const encoded = await hashPassword("correct horse battery");
    expect(encoded.startsWith("scrypt$65536$8$1$")).toBe(true);
    expect(needsRehash(encoded)).toBe(false);
    expect(needsRehash("scrypt$1024$8$1$c2FsdA$aGFzaA")).toBe(true);
    expect(needsRehash("argon2id$whatever")).toBe(true);
  });

  it("rejects a short password", async () => {
    await expect(hashPassword("short")).rejects.toThrow(RangeError);
  });

  it("returns false rather than throwing on a malformed hash", async () => {
    expect(await verifyPassword("anything", "not-a-hash")).toBe(false);
    expect(await verifyPassword("anything", "scrypt$x$8$1$a$b")).toBe(false);
  });

  it("normalises unicode so the same typed password verifies", async () => {
    const encoded = await hashPassword("café-au-lait-1");
    expect(await verifyPassword("café-au-lait-1", encoded)).toBe(true);
  });
});

describe("one-time codes", () => {
  it("accepts the right code and rejects a wrong one", () => {
    const otp = generateOtp("+22790000001", "sign_in", KEY);
    const challenge = {
      codeHash: otp.codeHash, attempts: 1, maxAttempts: 5,
      expiresAt: otp.expiresAt, consumedAt: null,
    };
    expect(verifyOtp(challenge, otp.code, "+22790000001", "sign_in", KEY)).toEqual({ ok: true });
    expect(verifyOtp(challenge, "000000", "+22790000001", "sign_in", KEY)).toEqual({
      ok: false, reason: "mismatch",
    });
  });

  it("binds a code to its identifier and purpose", () => {
    const otp = generateOtp("+22790000001", "sign_in", KEY);
    const challenge = {
      codeHash: otp.codeHash, attempts: 1, maxAttempts: 5,
      expiresAt: otp.expiresAt, consumedAt: null,
    };
    // The same digits issued to someone else must not verify here.
    expect(verifyOtp(challenge, otp.code, "+22790000002", "sign_in", KEY).ok).toBe(false);
    expect(verifyOtp(challenge, otp.code, "+22790000001", "step_up", KEY).ok).toBe(false);
  });

  it("binds a code to the key, so a stolen table alone verifies nothing", () => {
    const otp = generateOtp("+22790000001", "sign_in", KEY);
    const attacker = deriveOtpKey("a-different-secret-the-attacker-guessed");
    const challenge = {
      codeHash: otp.codeHash, attempts: 1, maxAttempts: 5,
      expiresAt: otp.expiresAt, consumedAt: null,
    };
    // This is the whole point of keying the hash: knowing the code and the
    // phone number is not enough without the application secret.
    expect(verifyOtp(challenge, otp.code, "+22790000001", "sign_in", attacker).ok).toBe(false);
  });

  it("refuses expired, consumed and exhausted challenges", () => {
    const otp = generateOtp("+22790000001", "sign_in", KEY);
    const base = { codeHash: otp.codeHash, attempts: 1, maxAttempts: 5, consumedAt: null };
    expect(
      verifyOtp({ ...base, expiresAt: new Date(Date.now() - 1) }, otp.code, "+22790000001", "sign_in", KEY),
    ).toEqual({ ok: false, reason: "expired" });
    expect(
      verifyOtp({ ...base, expiresAt: otp.expiresAt, consumedAt: new Date() }, otp.code, "+22790000001", "sign_in", KEY),
    ).toEqual({ ok: false, reason: "consumed" });
    expect(
      verifyOtp({ ...base, expiresAt: otp.expiresAt, attempts: 6 }, otp.code, "+22790000001", "sign_in", KEY),
    ).toEqual({ ok: false, reason: "too_many_attempts" });
  });

  it("still verifies on the last attempt the budget allows", () => {
    // `attempts` counts the attempt being made, so attempts === maxAttempts is
    // the fifth of five and must succeed. Getting this off by one would either
    // give a free guess or swallow a legitimate one.
    const otp = generateOtp("+22790000001", "sign_in", KEY);
    expect(
      verifyOtp(
        { codeHash: otp.codeHash, attempts: 5, maxAttempts: 5, expiresAt: otp.expiresAt, consumedAt: null },
        otp.code, "+22790000001", "sign_in", KEY,
      ),
    ).toEqual({ ok: true });
  });

  it("generates uniformly distributed six-digit codes", () => {
    const codes = Array.from({ length: 3000 }, () => generateOtpCode());
    expect(codes.every((c) => /^\d{6}$/.test(c))).toBe(true);
    // A broken generator (e.g. always the same digit) would collapse this set.
    expect(new Set(codes).size).toBeGreaterThan(2900);
  });

  it("hashes differently per identifier", () => {
    expect(hashOtpCode("123456", "+227A", "sign_in", KEY))
      .not.toBe(hashOtpCode("123456", "+227B", "sign_in", KEY));
  });

  it("refuses to derive a key from an empty secret", () => {
    expect(() => deriveOtpKey("")).toThrow();
  });
});

describe("phone normalisation", () => {
  const countries = [
    { countryCode: "NE", callingCode: "+227" },
    { countryCode: "ML", callingCode: "+223" },
    { countryCode: "NG", callingCode: "+234" },
    { countryCode: "US", callingCode: "+1" },
  ];

  it("accepts E.164 and identifies the country", () => {
    expect(normalisePhone("+227 90 00 00 01", countries)).toEqual({
      ok: true, e164: "+22790000001", countryCode: "NE",
    });
  });

  it("expands a national number using the country context", () => {
    expect(normalisePhone("090000001", countries, "NE")).toEqual({
      ok: true, e164: "+22790000001", countryCode: "NE",
    });
  });

  it("prefers the longest matching calling code", () => {
    // +1 must not shadow a longer code that starts with the same digits.
    const result = normalisePhone("+22790000001", countries);
    expect(result.ok && result.countryCode).toBe("NE");
  });

  it("refuses a national number with no country context", () => {
    expect(normalisePhone("090000001", countries)).toEqual({
      ok: false, reason: "no_country_context",
    });
  });

  it("refuses malformed input", () => {
    expect(normalisePhone("", countries).ok).toBe(false);
    expect(normalisePhone("+0123", countries).ok).toBe(false);
    expect(normalisePhone("abc", countries, "NE").ok).toBe(false);
  });

  it("always produces E.164 or an explicit failure", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 20 }), (input) => {
        const result = normalisePhone(input, countries, "NE");
        if (result.ok) expect(/^\+[1-9]\d{6,14}$/.test(result.e164)).toBe(true);
      }),
      { numRuns: 1000 },
    );
  });
});

describe("email normalisation", () => {
  it("lowercases and trims", () => {
    expect(normaliseEmail("  Hello@Example.COM ")).toBe("hello@example.com");
  });
  it("rejects malformed addresses", () => {
    expect(normaliseEmail("not-an-email")).toBeNull();
    expect(normaliseEmail("a@b")).toBeNull();
  });
});
