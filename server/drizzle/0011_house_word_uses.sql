ALTER TABLE `group_words` ADD `uses` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- backfill: every word formed by a play in the group's finished games
UPDATE `group_words` SET `uses` = (
  SELECT count(*) FROM `moves` m JOIN `games` g ON g.`id` = m.`game_id`, json_each(m.`words`) w
  WHERE g.`group_id` = `group_words`.`group_id` AND g.`status` = 'finished' AND m.`type` = 'play' AND json_extract(w.`value`, '$.word') = `group_words`.`word`
) WHERE `kind` = 'add';
