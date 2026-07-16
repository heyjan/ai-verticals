DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'chat_ro') THEN
		CREATE ROLE chat_ro
			LOGIN
			NOINHERIT
			NOSUPERUSER
			NOCREATEDB
			NOCREATEROLE
			NOREPLICATION;
	END IF;
END
$$;
--> statement-breakpoint
ALTER ROLE chat_ro SET default_transaction_read_only = true;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM chat_ro;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO chat_ro;
--> statement-breakpoint
GRANT SELECT ON TABLE
	jobs,
	subcategories,
	tools,
	job_subcategories,
	job_tools,
	company_descriptions
TO chat_ro;
