CREATE TABLE "countries" (
	"code" char(2) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"currency_code" char(3) NOT NULL,
	"calling_code" text NOT NULL,
	"default_locale" text NOT NULL,
	"is_supported" boolean DEFAULT false NOT NULL,
	"launched_at" timestamp with time zone,
	CONSTRAINT "countries_calling_code_format" CHECK ("countries"."calling_code" ~ '^\+[0-9]{1,4}$')
);
--> statement-breakpoint
CREATE TABLE "currencies" (
	"code" char(3) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"minor_unit" smallint NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "currencies_minor_unit_plausible" CHECK ("currencies"."minor_unit" between 0 and 4)
);
--> statement-breakpoint
CREATE TABLE "locales" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otp_challenges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"identifier" text NOT NULL,
	"code_hash" text NOT NULL,
	"purpose" text NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"max_attempts" smallint DEFAULT 5 NOT NULL,
	"consumed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"requested_by_ip" "inet",
	CONSTRAINT "otp_attempts_bounded" CHECK ("otp_challenges"."attempts" >= 0 and "otp_challenges"."attempts" <= "otp_challenges"."max_attempts"),
	CONSTRAINT "otp_kind_valid" CHECK ("otp_challenges"."kind" in ('phone','email'))
);
--> statement-breakpoint
CREATE TABLE "rate_limit_counters" (
	"bucket" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"elevated_at" timestamp with time zone,
	"ip_address" "inet",
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "user_identities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"identifier" text NOT NULL,
	"verified_at" timestamp with time zone,
	"password_hash" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_identities_kind_valid" CHECK ("user_identities"."kind" in ('phone','email'))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"display_name" text,
	"country_code" char(2),
	"locale" text DEFAULT 'fr' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "permissions" (
	"key" text PRIMARY KEY NOT NULL,
	"description" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "role_assignments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"scope_type" text NOT NULL,
	"scope_id" uuid,
	"granted_by" uuid,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "role_assignments_scope_id_matches_type" CHECK (("role_assignments"."scope_type" = 'global' and "role_assignments"."scope_id" is null) or ("role_assignments"."scope_type" <> 'global' and "role_assignments"."scope_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "role_permissions" (
	"role_id" uuid NOT NULL,
	"permission_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"description" text NOT NULL,
	"scope_type" text NOT NULL,
	"is_assignable" text DEFAULT 'true' NOT NULL,
	CONSTRAINT "roles_scope_type_valid" CHECK ("roles"."scope_type" in ('global','store','course','zone'))
);
--> statement-breakpoint
CREATE TABLE "consent_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"document_version_id" uuid NOT NULL,
	"accepted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip_address" "inet",
	"user_agent" text,
	"locale" text,
	"method" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal_document_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"document_id" uuid NOT NULL,
	"version" text NOT NULL,
	"locale" text NOT NULL,
	"content_hash" text NOT NULL,
	"content_uri" text,
	"effective_from" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"country_code" char(2),
	CONSTRAINT "legal_documents_kind_valid" CHECK ("legal_documents"."kind" in ('terms_of_use','privacy_policy','seller_terms','instructor_terms','payment_refund_policy','payout_terms','referral_terms','delivery_terms'))
);
--> statement-breakpoint
CREATE TABLE "account_balances" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"balance_minor" bigint DEFAULT 0 NOT NULL,
	"entry_count" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"key" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"request_hash" text NOT NULL,
	"result_ref" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"owner_type" text,
	"owner_id" uuid,
	"currency" char(3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_accounts_kind_valid" CHECK (kind in ('external_customer','psp_clearing','platform_escrow','platform_revenue','user_pending','user_available','payout_payable','external_payout')),
	CONSTRAINT "ledger_accounts_owner_consistent" CHECK (("ledger_accounts"."owner_type" is null and "ledger_accounts"."owner_id" is null) or ("ledger_accounts"."owner_type" is not null and "ledger_accounts"."owner_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"transaction_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"direction" smallint NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ledger_entries_direction_valid" CHECK ("ledger_entries"."direction" in (-1, 1)),
	CONSTRAINT "ledger_entries_amount_positive" CHECK ("ledger_entries"."amount_minor" > 0)
);
--> statement-breakpoint
CREATE TABLE "ledger_transactions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"idempotency_key" text,
	"reverses_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_user_id" uuid,
	"actor_kind" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"before" jsonb,
	"after" jsonb,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip_address" "inet",
	"user_agent" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "platform_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"description" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "countries" ADD CONSTRAINT "countries_currency_code_currencies_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_identities" ADD CONSTRAINT "user_identities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_country_code_countries_code_fk" FOREIGN KEY ("country_code") REFERENCES "public"."countries"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_assignments" ADD CONSTRAINT "role_assignments_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_roles_id_fk" FOREIGN KEY ("role_id") REFERENCES "public"."roles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_key_permissions_key_fk" FOREIGN KEY ("permission_key") REFERENCES "public"."permissions"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_document_version_id_legal_document_versions_id_fk" FOREIGN KEY ("document_version_id") REFERENCES "public"."legal_document_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "legal_document_versions" ADD CONSTRAINT "legal_document_versions_document_id_legal_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."legal_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_balances" ADD CONSTRAINT "account_balances_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_transaction_id_ledger_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_account_id_ledger_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."ledger_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "otp_identifier_idx" ON "otp_challenges" USING btree ("kind","identifier");--> statement-breakpoint
CREATE INDEX "otp_expires_idx" ON "otp_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "rate_limit_bucket_window_key" ON "rate_limit_counters" USING btree ("bucket","window_start");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "user_identities_kind_identifier_key" ON "user_identities" USING btree ("kind","identifier");--> statement-breakpoint
CREATE INDEX "user_identities_user_idx" ON "user_identities" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "role_assignments_user_idx" ON "role_assignments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "role_assignments_scope_idx" ON "role_assignments" USING btree ("scope_type","scope_id");--> statement-breakpoint
CREATE UNIQUE INDEX "role_permissions_key" ON "role_permissions" USING btree ("role_id","permission_key");--> statement-breakpoint
CREATE UNIQUE INDEX "roles_key_key" ON "roles" USING btree ("key");--> statement-breakpoint
CREATE UNIQUE INDEX "consent_records_user_version_key" ON "consent_records" USING btree ("user_id","document_version_id");--> statement-breakpoint
CREATE INDEX "consent_records_user_idx" ON "consent_records" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "legal_document_versions_key" ON "legal_document_versions" USING btree ("document_id","version","locale");--> statement-breakpoint
CREATE INDEX "legal_document_versions_effective_idx" ON "legal_document_versions" USING btree ("document_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "legal_documents_kind_country_key" ON "legal_documents" USING btree ("kind","country_code");--> statement-breakpoint
CREATE INDEX "idempotency_scope_idx" ON "idempotency_keys" USING btree ("scope");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_accounts_identity_key" ON "ledger_accounts" USING btree ("kind",coalesce("owner_type", ''),coalesce("owner_id", '00000000-0000-0000-0000-000000000000'::uuid),"currency");--> statement-breakpoint
CREATE INDEX "ledger_accounts_owner_idx" ON "ledger_accounts" USING btree ("owner_type","owner_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_transaction_idx" ON "ledger_entries" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_account_idx" ON "ledger_entries" USING btree ("account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_transactions_idempotency_key" ON "ledger_transactions" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "ledger_transactions_occurred_idx" ON "ledger_transactions" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "ledger_transactions_reverses_idx" ON "ledger_transactions" USING btree ("reverses_id");--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" USING btree ("actor_user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_logs_target_idx" ON "audit_logs" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "audit_logs_occurred_idx" ON "audit_logs" USING btree ("occurred_at");