// SPDX-License-Identifier: AGPL-3.0-or-later
// Tables for milestone 2. Groups, ratings, resets and earned invites come with their milestones (SPEC §5, §13).
import { sql } from 'drizzle-orm';
import { integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { Bag, Board, MoveRecord, Placement, WordScore } from '../../../shared/types';

const now = () => sql`(unixepoch() * 1000)`;
const ms = (name: string) => integer(name, { mode: 'number' });
const bool = (name: string) => integer(name, { mode: 'boolean' });

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(), // lowercase
  passwordHash: text('password_hash').notNull(),
  displayName: text('display_name').notNull(),
  colorIndex: integer('color_index'),
  isAdmin: bool('is_admin').notNull().default(false),
  invitedBy: text('invited_by'),
  remindTurn: bool('remind_turn').notNull().default(true),
  createdAt: ms('created_at').notNull().default(now()),
  passwordChangedAt: ms('password_changed_at').notNull().default(now()),
});

export const pushSubs = sqliteTable('push_subs', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  createdAt: ms('created_at').notNull().default(now()),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(), // SHA-256 of the cookie token
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  pushSubId: text('push_sub_id').references(() => pushSubs.id, { onDelete: 'set null' }),
  expiresAt: ms('expires_at').notNull(),
  createdAt: ms('created_at').notNull().default(now()),
  userAgent: text('user_agent'),
});

export const invites = sqliteTable('invites', {
  codeHash: text('code_hash').primaryKey(),
  codeHint: text('code_hint').notNull(),
  createdBy: text('created_by').references(() => users.id), // null = CLI
  usedBy: text('used_by').unique().references(() => users.id),
  usedAt: ms('used_at'),
  expiresAt: ms('expires_at'),
  revokedAt: ms('revoked_at'),
  note: text('note'),
  createdAt: ms('created_at').notNull().default(now()),
});

export const games = sqliteTable('games', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  hostId: text('host_id').notNull().references(() => users.id),
  status: text('status', { enum: ['lobby', 'active', 'finished'] }).notNull().default('lobby'),
  seatCount: integer('seat_count').notNull(),
  bagSize: integer('bag_size').$type<100 | 150>().notNull(),
  randomOrder: bool('random_order').notNull(),
  expandedWords: bool('expanded_words').notNull().default(false), // also accept SCOWL abbreviations (SPEC §4.9)
  joinCode: text('join_code').notNull().unique(),
  createdAt: ms('created_at').notNull().default(now()),
  startedAt: ms('started_at'),
  finishedAt: ms('finished_at'),
  // live state; server-only (SPEC §6.1)
  board: text('board', { mode: 'json' }).$type<Board>(),
  bag: text('bag', { mode: 'json' }).$type<Bag>(),
  turnNumber: integer('turn_number').notNull().default(0),
  currentSeat: integer('current_seat').notNull().default(0),
  scorelessStreak: integer('scoreless_streak').notNull().default(0),
  finalRoundAfter: integer('final_round_after'),
  turnStartedAt: ms('turn_started_at'),
  reminderSent: bool('reminder_sent').notNull().default(false),
});

export const gamePlayers = sqliteTable(
  'game_players',
  {
    gameId: text('game_id').notNull().references(() => games.id, { onDelete: 'cascade' }),
    seat: integer('seat').notNull(),
    userId: text('user_id').notNull().references(() => users.id),
    rack: text('rack', { mode: 'json' }).$type<string[]>().notNull().default(sql`'[]'`),
    score: integer('score').notNull().default(0),
    joinedAt: ms('joined_at').notNull().default(now()),
    lastNudgeAt: ms('last_nudge_at'),
  },
  (t) => [primaryKey({ columns: [t.gameId, t.seat] }), uniqueIndex('game_players_user').on(t.gameId, t.userId)],
);

export const moves = sqliteTable('moves', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  gameId: text('game_id').notNull().references(() => games.id, { onDelete: 'cascade' }),
  turnNumber: integer('turn_number').notNull(),
  seat: integer('seat').notNull(),
  type: text('type', { enum: ['play', 'swap', 'pass'] }).notNull(),
  tiles: text('tiles', { mode: 'json' }).$type<Required<Placement>[]>(),
  words: text('words', { mode: 'json' }).$type<WordScore[]>(),
  score: integer('score').notNull(),
  swappedCount: integer('swapped_count'),
  private: text('private', { mode: 'json' }).$type<MoveRecord['private']>(), // only ever shown to the mover
  createdAt: ms('created_at').notNull().default(now()),
});
