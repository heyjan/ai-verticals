CREATE TABLE "jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"source_id" text NOT NULL,
	"title" text NOT NULL,
	"company" text NOT NULL,
	"location" text NOT NULL,
	"city" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"salary" text DEFAULT '' NOT NULL,
	"job_level" text DEFAULT '' NOT NULL,
	"posted_ago" text DEFAULT '' NOT NULL,
	"contract_type" text DEFAULT '' NOT NULL,
	"sector" text DEFAULT '' NOT NULL,
	"url" text DEFAULT '' NOT NULL,
	"category" text DEFAULT 'Other' NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subcategories" (
	"id" serial PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"name" text NOT NULL,
	"keywords" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tools" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"keywords" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tools_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "job_subcategories" (
	"job_id" integer NOT NULL,
	"subcategory_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_subcategories_job_id_subcategory_id_pk" PRIMARY KEY("job_id","subcategory_id")
);
--> statement-breakpoint
CREATE TABLE "job_tools" (
	"job_id" integer NOT NULL,
	"tool_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_tools_job_id_tool_id_pk" PRIMARY KEY("job_id","tool_id")
);
--> statement-breakpoint
CREATE TABLE "company_descriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"company" text NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_descriptions_company_unique" UNIQUE("company")
);
--> statement-breakpoint
ALTER TABLE "job_subcategories" ADD CONSTRAINT "job_subcategories_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "job_subcategories" ADD CONSTRAINT "job_subcategories_subcategory_id_subcategories_id_fk" FOREIGN KEY ("subcategory_id") REFERENCES "public"."subcategories"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "job_tools" ADD CONSTRAINT "job_tools_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "job_tools" ADD CONSTRAINT "job_tools_tool_id_tools_id_fk" FOREIGN KEY ("tool_id") REFERENCES "public"."tools"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_source_unique" ON "jobs" USING btree ("source","source_id");--> statement-breakpoint
CREATE INDEX "jobs_category_idx" ON "jobs" USING btree ("category");--> statement-breakpoint
CREATE INDEX "jobs_city_idx" ON "jobs" USING btree ("city");--> statement-breakpoint
CREATE INDEX "jobs_company_idx" ON "jobs" USING btree ("company");--> statement-breakpoint
CREATE INDEX "jobs_first_seen_at_idx" ON "jobs" USING btree ("first_seen_at");--> statement-breakpoint
CREATE INDEX "jobs_last_seen_at_idx" ON "jobs" USING btree ("last_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "subcategories_category_name_unique" ON "subcategories" USING btree ("category","name");--> statement-breakpoint
CREATE INDEX "job_subcategories_subcategory_idx" ON "job_subcategories" USING btree ("subcategory_id");--> statement-breakpoint
CREATE INDEX "job_tools_tool_idx" ON "job_tools" USING btree ("tool_id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
	NEW.updated_at = now();
	RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER jobs_set_updated_at
	BEFORE UPDATE ON "jobs"
	FOR EACH ROW
	WHEN (
		OLD.title IS DISTINCT FROM NEW.title
		OR OLD.company IS DISTINCT FROM NEW.company
		OR OLD.location IS DISTINCT FROM NEW.location
		OR OLD.city IS DISTINCT FROM NEW.city
		OR OLD.description IS DISTINCT FROM NEW.description
		OR OLD.salary IS DISTINCT FROM NEW.salary
		OR OLD.job_level IS DISTINCT FROM NEW.job_level
		OR OLD.posted_ago IS DISTINCT FROM NEW.posted_ago
		OR OLD.contract_type IS DISTINCT FROM NEW.contract_type
		OR OLD.sector IS DISTINCT FROM NEW.sector
		OR OLD.url IS DISTINCT FROM NEW.url
		OR OLD.category IS DISTINCT FROM NEW.category
	)
	EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER subcategories_set_updated_at
	BEFORE UPDATE ON "subcategories"
	FOR EACH ROW
	WHEN (OLD.* IS DISTINCT FROM NEW.*)
	EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER tools_set_updated_at
	BEFORE UPDATE ON "tools"
	FOR EACH ROW
	WHEN (OLD.* IS DISTINCT FROM NEW.*)
	EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER company_descriptions_set_updated_at
	BEFORE UPDATE ON "company_descriptions"
	FOR EACH ROW
	WHEN (OLD.* IS DISTINCT FROM NEW.*)
	EXECUTE FUNCTION set_updated_at();
