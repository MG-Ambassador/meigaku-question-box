CREATE TABLE `admin_challenges` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`expires_at` integer NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `admin_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`email` text NOT NULL,
	`expires_at` integer NOT NULL
);
