CREATE TABLE "cv_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"name" text DEFAULT 'Untitled Template' NOT NULL,
	"layout" text DEFAULT 'one-column' NOT NULL,
	"theme" jsonb NOT NULL,
	"page" jsonb NOT NULL,
	"skeleton" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cv_text_blocks" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"label" text NOT NULL,
	"kind" text DEFAULT 'paragraph' NOT NULL,
	"content" jsonb NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cv_documents" ADD COLUMN "slot_assignments" jsonb;
--> statement-breakpoint
ALTER TABLE "cv_templates" ADD CONSTRAINT "cv_templates_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "cv_text_blocks" ADD CONSTRAINT "cv_text_blocks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "cv_templates_user_idx" ON "cv_templates" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "cv_text_blocks_user_idx" ON "cv_text_blocks" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "cv_text_blocks_tags_idx" ON "cv_text_blocks" USING gin ("tags");
--> statement-breakpoint
CREATE TRIGGER cv_templates_set_updated_at
	BEFORE UPDATE ON cv_templates
	FOR EACH ROW
	WHEN (OLD.* IS DISTINCT FROM NEW.*)
	EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER cv_text_blocks_set_updated_at
	BEFORE UPDATE ON cv_text_blocks
	FOR EACH ROW
	WHEN (OLD.* IS DISTINCT FROM NEW.*)
	EXECUTE FUNCTION set_updated_at();
