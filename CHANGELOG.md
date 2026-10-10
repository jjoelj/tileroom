# Changelog

What changed in each release of Tileroom. Versions follow [semver](https://semver.org): fixes bump the last
number, features the middle one. Production runs the newest `v*` tag; staging runs `master`.

## Unreleased

- New games use the classic board by default, with fewer bonus squares and a double-word start. The old board is still there as Special. Games already running keep their board.
- New game opens your game straight away. Its settings (board, tile bag, turn order, word list) are in the lobby, where you can change them until you start. Everyone waiting sees them.

## v0.7.1 (2026-10-09)

- Back no longer closes the app after an update, or after opening a game from a notification and tapping around.

## v0.7.0 (2026-10-09)

- Tapping a pop-up message about another game or group works like tapping its notification: it opens there with the latest.
- Back from a game opened from a notification or a link goes to your games instead of closing the app. Back from a game you just started or joined goes to where you started it, like its group, not the New game or Join screen.
- Notifications you've already opened or swiped away on one device clear on your others the next time Tileroom opens there. A phone that was offline gets only the latest notification for each game.
- The swap sheet shows your tiles in the same order as your rack.
- Drag a tile you've placed onto another one you've placed and they swap squares.
- "Your turn" stands out in a game. Times on your games list and group pages are short (3m, 2d), and the game screen no longer shows them.
- When a word is played while you have the game open, yours or anyone's, the board moves so you can see it and the tiles are set down one by one.

## v0.6.0 (2026-10-09)

- Android's back button works throughout: it closes an open sheet, menu or dialog first, then goes back a screen. The back arrows in the app do the same.
- A tidier group page: the group code sits near the top and stays hidden until you tap Show, New game shrinks to a small button when games are running, Propose sits beside the word box, and Members and Settings (now with Rename) fold away.
- Pop-up messages match your light or dark theme.
- A group's finished games are on its page under Past games, with who won. Tap View to see the final board, and Show more for older ones.
- You can delete your account in Settings (it asks for your password). Your past games stay for the other players, shown as ⊘ Deleted (nobody else can put ⊘ in their name). A deleted player can't be nudged; their running games end after 7 days without a move.
- If the host of a game that hasn't started leaves, the game is canceled for everyone. A game that's gone now just says it doesn't exist.
- Games show how long ago the last move was, on your games list, on group pages and in the game.
- When someone joins a game you started, you get a notification.

## v0.5.0 (2026-10-09)

- Leaderboards: a global one and one for each group, ranked by wins or points (ties count as wins for everyone tied). Open it from the trophy on the games list or on a group's page. Everyone's on it from the start, at 0 until they finish a game.
- You can leave the global leaderboard (on the leaderboard or in Settings). You still see where you'd be, and you always show on your groups' boards.
- No more "Checking for updates" screen when you open the app or come back to it. A new version just shows the "Update ready · Reload" button.
- A blank tile stays on its square while you pick its letter, instead of jumping back to your rack.

## v0.4.1 (2026-10-09)

- The board has a little room around its edge, so the outline around words on the edge shows, and tiles dropped just past an edge square land on it.

## v0.4.0 (2026-10-09)

- If a new version comes out while you're playing, an "Update ready · Reload" button appears at the bottom within moments of the release. Tap it when you're ready; nothing reloads on its own.
- The zoom button is gone, so it no longer covers the bottom-right square. Double-tap or pinch the board to zoom (Ctrl+scroll on a computer).
- Updates install themselves. When you open the app, or come back after a while, it checks for a new version behind a short splash screen before showing anything.

## v0.3.0 (2026-10-09)

- "Sam played SUN" names the word most of Sam's new tiles went into, not whichever word happened to be found first.
- In a game, a player's dot pulses while they have the game open, so you can see who's there right now.

## v0.2.0 (2026-10-09)

- While you're using the app, news from your other games and groups (your turn, a new group game, votes) shows as a banner at the top. Tap it to go there.
- When someone opens a game in your group, you get a notification so you can join before it starts. A group page that's open shows the new game right away.
- Board squares and tiles no longer get the hover tint.
- What's new: after an update, a popup lists what changed. It's also in Settings > What's new.
- Change your password in Settings. Your other devices are signed out; the one you're on stays signed in.
- "You're all set" only goes to the device you just set up. The Settings test notification still goes to all of them.

## v0.1.1 (2026-10-09)

- Sign in or create an account first, in any browser. Phones and tablets are asked to install the app after that.
- Opening an account invite link while signed in leaves the invite unused and says it's for someone new.

## v0.1.0 (2026-10-09)

First release.

- Crossword-style tile game for 2 to 6 players, with async turns, drag-and-drop tiles and live word checking.
- Groups with their own house words, voted in unanimously, and games only members can join. Members can watch
  each other's group games.
- Invite-only accounts: you join with a single-use invite link or code.
- Push notifications for your turn, game starts and endings. Desktop works in a browser tab; phones use the
  installed app.
- Settings: display name, theme, test notification, sign out.
- The version in the bottom-right corner links to the source code for exactly that release.
