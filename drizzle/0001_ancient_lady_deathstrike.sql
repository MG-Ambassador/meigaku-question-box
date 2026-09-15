CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`date` text DEFAULT '' NOT NULL,
	`open` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
DROP INDEX `questions_status_created`;--> statement-breakpoint
ALTER TABLE `questions` ADD `event_id` text;--> statement-breakpoint
CREATE INDEX `questions_status_created` ON `questions` (`event_id`,`status`,`created_at`);