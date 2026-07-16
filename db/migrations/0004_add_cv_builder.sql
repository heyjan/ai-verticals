CREATE TYPE "user_role" AS ENUM ('user', 'admin');
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "role" "user_role" DEFAULT 'user' NOT NULL;
--> statement-breakpoint
CREATE TABLE "cv_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"template_id" text NOT NULL,
	"title" text DEFAULT 'Untitled CV' NOT NULL,
	"content" jsonb NOT NULL,
	"theme_overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"page" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cv_files" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"document_id" integer,
	"kind" text NOT NULL,
	"format" text,
	"original_name" text NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cv_files_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
ALTER TABLE "cv_documents" ADD CONSTRAINT "cv_documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "cv_files" ADD CONSTRAINT "cv_files_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "cv_files" ADD CONSTRAINT "cv_files_document_id_cv_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."cv_documents"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "cv_documents_user_idx" ON "cv_documents" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "cv_documents_user_updated_at_idx" ON "cv_documents" USING btree ("user_id","updated_at");
--> statement-breakpoint
CREATE INDEX "cv_files_user_idx" ON "cv_files" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX "cv_files_document_idx" ON "cv_files" USING btree ("document_id");
--> statement-breakpoint
CREATE TRIGGER users_set_updated_at
	BEFORE UPDATE ON users
	FOR EACH ROW
	WHEN (OLD.* IS DISTINCT FROM NEW.*)
	EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint
CREATE TRIGGER cv_documents_set_updated_at
	BEFORE UPDATE ON cv_documents
	FOR EACH ROW
	WHEN (OLD.* IS DISTINCT FROM NEW.*)
	EXECUTE FUNCTION set_updated_at();
