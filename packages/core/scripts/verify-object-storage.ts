import { verifyObjectStorage } from "../src/content/verify";

/**
 * CLI wrapper. Run against whatever `CONTENT_S3_*` is in the environment:
 *
 *     pnpm --filter @afrinext/core verify:storage
 *
 * All the reasoning lives in `src/content/verify.ts`, where tests can reach it.
 * This file only decides what appears on a terminal — which is also what keeps
 * credentials out of the output: it prints the checks and the origin, and never
 * the configuration.
 */
async function main(): Promise<void> {
  if (process.env["CONTENT_STORAGE"] !== "s3") {
    console.error(
      `CONTENT_STORAGE is "${process.env["CONTENT_STORAGE"] ?? "unset"}", not "s3". ` +
      "This verifies a real object store; there is nothing to verify otherwise.",
    );
    process.exit(2);
  }

  const result = await verifyObjectStorage(process.env);

  console.log(`Endpoint  ${result.origin}`);
  console.log(`Bucket    ${result.bucket}`);
  console.log(`Key       ${result.key}\n`);
  for (const check of result.checks) {
    const detail = check.detail === undefined ? "" : ` — ${check.detail}`;
    console.log(`  ${check.ok ? "PASS" : "FAIL"}  ${check.label}${check.ok ? "" : detail}`);
  }

  const failed = result.checks.filter((c) => !c.ok).length;
  console.log("");
  console.log(result.ok
    ? "ALL CHECKS PASSED"
    : `${failed} CHECK(S) FAILED — do not deploy against this bucket.`);
  process.exit(result.ok ? 0 : 1);
}

main().catch((error: unknown) => {
  // Deliberately the message only. An error object from fetch can carry the
  // request, and the request carries the Authorization header.
  console.error(`verify:storage failed: ${(error as Error).message}`);
  process.exit(1);
});
