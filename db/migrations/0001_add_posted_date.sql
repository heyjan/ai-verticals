ALTER TABLE "jobs" ADD COLUMN "posted_date" date;--> statement-breakpoint
CREATE INDEX "jobs_posted_date_idx" ON "jobs" USING btree ("posted_date");
