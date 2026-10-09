CREATE TABLE `game_words` (
	`game_id` text NOT NULL,
	`word` text NOT NULL,
	`kind` text NOT NULL,
	PRIMARY KEY(`game_id`, `word`),
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `group_members` (
	`group_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`joined_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`group_id`, `user_id`),
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `group_words` (
	`group_id` text NOT NULL,
	`word` text NOT NULL,
	`kind` text NOT NULL,
	`approved_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`proposal_id` text,
	PRIMARY KEY(`group_id`, `word`),
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`proposal_id`) REFERENCES `proposals`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`created_by` text NOT NULL,
	`join_code` text NOT NULL,
	`spectators_see_racks` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `groups_join_code_unique` ON `groups` (`join_code`);--> statement-breakpoint
CREATE TABLE `proposal_votes` (
	`proposal_id` text NOT NULL,
	`user_id` text NOT NULL,
	`vote` text NOT NULL,
	`voted_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`proposal_id`, `user_id`),
	FOREIGN KEY (`proposal_id`) REFERENCES `proposals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `proposals` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`word` text NOT NULL,
	`action` text NOT NULL,
	`proposed_by` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`closes_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`proposed_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `proposals_open_word` ON `proposals` (`group_id`,`word`) WHERE status = 'open';--> statement-breakpoint
ALTER TABLE `games` ADD `group_id` text REFERENCES groups(id);--> statement-breakpoint
ALTER TABLE `games` ADD `spectator_racks` integer DEFAULT false NOT NULL;