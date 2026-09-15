CREATE TABLE `audit` (
	`id` text PRIMARY KEY NOT NULL,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`question_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `limits` (
	`key` text PRIMARY KEY NOT NULL,
	`count` integer NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `questions` (
	`id` text PRIMARY KEY NOT NULL,
	`body` text NOT NULL,
	`category` text NOT NULL,
	`source` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`answer` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `questions_status_created` ON `questions` (`status`,`created_at`);