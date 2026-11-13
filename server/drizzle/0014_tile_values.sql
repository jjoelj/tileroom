ALTER TABLE `games` ADD `tile_values` text DEFAULT 'special' NOT NULL;--> statement-breakpoint
-- Started games keep the values they were played on (special); lobbies take the new default.
UPDATE `games` SET `tile_values` = 'default' WHERE `status` = 'lobby';
