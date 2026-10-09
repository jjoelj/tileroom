CREATE TABLE `game_players` (
	`game_id` text NOT NULL,
	`seat` integer NOT NULL,
	`user_id` text NOT NULL,
	`rack` text DEFAULT '[]' NOT NULL,
	`score` integer DEFAULT 0 NOT NULL,
	`joined_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`last_nudge_at` integer,
	PRIMARY KEY(`game_id`, `seat`),
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `game_players_user` ON `game_players` (`game_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `games` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`host_id` text NOT NULL,
	`status` text DEFAULT 'lobby' NOT NULL,
	`seat_count` integer NOT NULL,
	`bag_size` integer NOT NULL,
	`random_order` integer NOT NULL,
	`join_code` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`board` text,
	`bag` text,
	`turn_number` integer DEFAULT 0 NOT NULL,
	`current_seat` integer DEFAULT 0 NOT NULL,
	`scoreless_streak` integer DEFAULT 0 NOT NULL,
	`final_round_after` integer,
	`turn_started_at` integer,
	`reminder_sent` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`host_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `games_join_code_unique` ON `games` (`join_code`);--> statement-breakpoint
CREATE TABLE `invites` (
	`code_hash` text PRIMARY KEY NOT NULL,
	`code_hint` text NOT NULL,
	`created_by` text,
	`used_by` text,
	`used_at` integer,
	`expires_at` integer,
	`revoked_at` integer,
	`note` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`used_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invites_used_by_unique` ON `invites` (`used_by`);--> statement-breakpoint
CREATE TABLE `moves` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`game_id` text NOT NULL,
	`turn_number` integer NOT NULL,
	`seat` integer NOT NULL,
	`type` text NOT NULL,
	`tiles` text,
	`words` text,
	`score` integer NOT NULL,
	`swapped_count` integer,
	`private` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`game_id`) REFERENCES `games`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `push_subs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subs_endpoint_unique` ON `push_subs` (`endpoint`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`push_sub_id` text,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`user_agent` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`push_sub_id`) REFERENCES `push_subs`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password_hash` text NOT NULL,
	`display_name` text NOT NULL,
	`color_index` integer,
	`is_admin` integer DEFAULT false NOT NULL,
	`invited_by` text,
	`remind_turn` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`password_changed_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);