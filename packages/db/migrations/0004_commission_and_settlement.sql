CREATE TABLE "commission_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"transaction_type" text NOT NULL,
	"country_code" char(2),
	"category_id" uuid,
	"store_id" uuid,
	"rate_bps" integer,
	"fixed_minor" bigint,
	"currency" char(3),
	"priority" integer DEFAULT 0 NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commission_rules_rate_sane" CHECK ("commission_rules"."rate_bps" is null or ("commission_rules"."rate_bps" >= 0 and "commission_rules"."rate_bps" <= 10000)),
	CONSTRAINT "commission_rules_has_a_charge" CHECK ("commission_rules"."rate_bps" is not null or "commission_rules"."fixed_minor" is not null),
	CONSTRAINT "commission_rules_window_ordered" CHECK ("commission_rules"."effective_to" is null or "commission_rules"."effective_to" > "commission_rules"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "fee_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"schedule_id" uuid NOT NULL,
	"key" text NOT NULL,
	"rule_id" uuid,
	"basis" text NOT NULL,
	"rate_bps" integer,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	CONSTRAINT "fee_lines_amount_non_negative" CHECK ("fee_lines"."amount_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "fee_schedules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"gross_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"resolved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_schedules_gross_non_negative" CHECK ("fee_schedules"."gross_minor" >= 0)
);
--> statement-breakpoint
CREATE TABLE "settlement_holds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" char(3) NOT NULL,
	"release_at" timestamp with time zone NOT NULL,
	"released_at" timestamp with time zone,
	"released_by_transaction_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "settlement_holds_amount_positive" CHECK ("settlement_holds"."amount_minor" > 0)
);
--> statement-breakpoint
ALTER TABLE "commission_rules" ADD CONSTRAINT "commission_rules_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_lines" ADD CONSTRAINT "fee_lines_schedule_id_fee_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."fee_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_lines" ADD CONSTRAINT "fee_lines_rule_id_commission_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."commission_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_lines" ADD CONSTRAINT "fee_lines_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_schedules" ADD CONSTRAINT "fee_schedules_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_holds" ADD CONSTRAINT "settlement_holds_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_holds" ADD CONSTRAINT "settlement_holds_released_by_transaction_id_ledger_transactions_id_fk" FOREIGN KEY ("released_by_transaction_id") REFERENCES "public"."ledger_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commission_rules_lookup_idx" ON "commission_rules" USING btree ("transaction_type","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_lines_schedule_key" ON "fee_lines" USING btree ("schedule_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "fee_schedules_subject_key" ON "fee_schedules" USING btree ("subject_type","subject_id");--> statement-breakpoint
CREATE UNIQUE INDEX "settlement_holds_subject_key" ON "settlement_holds" USING btree ("subject_type","subject_id","user_id");--> statement-breakpoint
CREATE INDEX "settlement_holds_due_idx" ON "settlement_holds" USING btree ("release_at");