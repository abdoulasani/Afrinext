"use client";

import { createAuthClient } from "better-auth/react";
import { phoneNumberClient } from "better-auth/client/plugins";

/**
 * Browser-side Better Auth client.
 *
 * Phone OTP is the primary route in this market; email and password exist for
 * people who prefer them. Nothing here decides what the signed-in person may
 * do — that is always the server's answer.
 */
export const authClient = createAuthClient({
  plugins: [phoneNumberClient()],
});
