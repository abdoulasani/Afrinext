import { beforeAll } from "vitest";

beforeAll(() => {
  const testUrl = process.env["TEST_DATABASE_URL"];
  if (testUrl !== undefined && testUrl !== "") process.env["DATABASE_URL"] = testUrl;
});
