import pg from "pg";
import { betterAuth } from "better-auth";
import { emailOTP, phoneNumber } from "better-auth/plugins";
import { getMigrations } from "better-auth/db/migration";

const pool = new pg.Pool({ connectionString: "postgres://postgres@127.0.0.1:5433/ba_probe" });

const auth = betterAuth({
  database: pool,
  baseURL: "http://localhost:3000",
  secret: "probe-secret-not-used-in-production-0123456789abcdef",
  emailAndPassword: { enabled: true },
  session: {
    additionalFields: {
      // Step-up re-verification for payout-sensitive actions.
      elevatedAt: { type: "date", required: false, input: false },
    },
  },
  plugins: [
    phoneNumber({ sendOTP: async () => {} }),
    emailOTP({ sendVerificationOTP: async () => {} }),
  ],
});

const { toBeCreated, runMigrations } = await getMigrations(auth.options);
console.log("tables to create:", toBeCreated.map((t: { table: string }) => t.table).join(", "));
await runMigrations();
console.log("migrations applied to ba_probe");
await pool.end();
