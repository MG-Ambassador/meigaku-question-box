CREATE TABLE `operator_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`operator_id` text NOT NULL,
	`version` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`operator_id`) REFERENCES `operators`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `operator_sessions_operator` ON `operator_sessions` (`operator_id`);--> statement-breakpoint
CREATE TABLE `operators` (
	`id` text PRIMARY KEY NOT NULL,
	`login_id` text NOT NULL,
	`display_name` text NOT NULL,
	`password_hash` text NOT NULL,
	`role` text DEFAULT 'operator' NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`must_change` integer DEFAULT 1 NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `operators_login_id_unique` ON `operators` (`login_id`);