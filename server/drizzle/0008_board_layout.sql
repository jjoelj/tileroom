ALTER TABLE `games` ADD `layout` text DEFAULT 'classic' NOT NULL;--> statement-breakpoint
-- Games from before layouts were played on what is now the special board.
UPDATE `games` SET `layout` = 'special';
