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
