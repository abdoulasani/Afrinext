"use client";

import { createAuthClient } from "better-auth/react";

/**
 * Browser-side Better Auth client.
 *
 * There is no phone-number client plugin because there is no Better Auth phone
 * plugin on the server: it stored codes in plaintext, so phone verification
 * moved back into Afrinext's own hashed table (review decision 1). The two
 * endpoints below are Afrinext's, served through the same auth handler, so they
 * get the same origin checks and the same session cookie handling.
 *
 * Nothing here decides what the signed-in person may do — that is always the
 * server's answer.
 */
export const authClient = createAuthClient();

export interface OtpResult {
  readonly error?: { readonly message?: string | undefined } | null;
}

export async function sendPhoneOtp(phoneNumber: string): Promise<OtpResult> {
  const { error } = await authClient.$fetch("/phone-otp/send", {
    method: "POST",
    body: { phoneNumber },
  });
  return { error };
}

export interface OutstandingDoc {
  readonly kind: string;
  readonly version: string;
  readonly locale: string;
}

export interface VerifyResult extends OtpResult {
  /**
   * What the new account must accept before it can be used.
   *
   * Reported so the client can show the right step. It is not what enforces
   * anything: the account is provisioned as `pending_consent` and resolves to
   * no actor regardless of whether this list is ever read.
   */
  readonly consentRequired?: readonly OutstandingDoc[];
}

export async function verifyPhoneOtp(phoneNumber: string, code: string): Promise<VerifyResult> {
  const { data, error } = await authClient.$fetch<{
    consentRequired?: OutstandingDoc[];
  }>("/phone-otp/verify", {
    method: "POST",
    body: { phoneNumber, code },
  });
  return { error, consentRequired: data?.consentRequired ?? [] };
}

/**
 * Accepts the general terms and activates the account.
 *
 * Plain fetch, not `authClient.$fetch`: this is an Afrinext v1 route, not a
 * Better Auth one, and the auth client would prefix it with the auth base path.
 */
export async function acceptAccountConsent(): Promise<OtpResult> {
  const response = await fetch("/api/v1/consent/account", {
    method: "POST",
    credentials: "same-origin",
    headers: { accept: "application/json" },
  });
  if (response.ok) return {};
  const body = (await response.json().catch(() => null)) as
    | { error?: { message?: string } }
    | null;
  return { error: { message: body?.error?.message ?? "" } };
}

// ---------------------------------------------------------------------------
// Email and password
// ---------------------------------------------------------------------------

/**
 * Better Auth's own credential endpoints, unchanged.
 *
 * They are its job: hashing (Afrinext's scrypt, configured server-side),
 * session issuance, and the cookie. What is deliberately NOT here is any
 * decision about what the signed-in person may then do — that stays with
 * `authorize()`, on the server, every time.
 */
export async function signUpWithEmail(
  input: { email: string; password: string; name: string },
): Promise<OtpResult> {
  const { error } = await authClient.signUp.email({
    email: input.email,
    password: input.password,
    name: input.name,
  });
  return { error };
}

export async function signInWithEmail(
  input: { email: string; password: string },
): Promise<OtpResult> {
  const { error } = await authClient.signIn.email({
    email: input.email,
    password: input.password,
  });
  return { error };
}

/**
 * Signs out, and means it.
 *
 * Better Auth deletes the `session` row — the only session store there is — so
 * the token is dead everywhere the moment this returns, not merely absent from
 * this browser. A client that only cleared its own cookie would leave a live
 * row behind for anyone holding the token.
 */
export async function signOut(): Promise<OtpResult> {
  const { error } = await authClient.signOut();
  return { error };
}

async function postJson(path: string, body?: unknown): Promise<{
  ok: boolean;
  code?: string;
  message?: string;
  data?: Record<string, unknown>;
}> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", accept: "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = (await response.json().catch(() => null)) as {
    data?: Record<string, unknown>;
    error?: { code?: string; message?: string };
  } | null;
  if (response.ok) return { ok: true, ...(payload?.data !== undefined ? { data: payload.data } : {}) };
  return {
    ok: false,
    ...(payload?.error?.code !== undefined ? { code: payload.error.code } : {}),
    ...(payload?.error?.message !== undefined ? { message: payload.error.message } : {}),
  };
}

export type ApiOutcome = Awaited<ReturnType<typeof postJson>>;

/** Sends a verification code to the signed-in account's own address. */
export function requestEmailVerification(): Promise<ApiOutcome> {
  return postJson("/api/v1/auth/email/verify");
}

export async function confirmEmailVerification(code: string): Promise<ApiOutcome> {
  const response = await fetch("/api/v1/auth/email/verify", {
    method: "PUT",
    credentials: "same-origin",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ code }),
  });
  const payload = (await response.json().catch(() => null)) as {
    error?: { code?: string; message?: string };
  } | null;
  return response.ok
    ? { ok: true }
    : {
        ok: false,
        ...(payload?.error?.code !== undefined ? { code: payload.error.code } : {}),
        ...(payload?.error?.message !== undefined ? { message: payload.error.message } : {}),
      };
}

export function requestPasswordReset(email: string): Promise<ApiOutcome> {
  return postJson("/api/v1/auth/password/forgot", { email });
}

export function resetPassword(
  input: { email: string; code: string; password: string },
): Promise<ApiOutcome> {
  return postJson("/api/v1/auth/password/reset", input);
}

export function chooseProgramme(programme: string): Promise<ApiOutcome> {
  return postJson("/api/v1/auth/programme", { programme });
}
