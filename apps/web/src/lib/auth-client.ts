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

export async function verifyPhoneOtp(phoneNumber: string, code: string): Promise<OtpResult> {
  const { error } = await authClient.$fetch("/phone-otp/verify", {
    method: "POST",
    body: { phoneNumber, code },
  });
  return { error };
}
