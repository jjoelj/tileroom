# Changelog

What changed in each release of Tileroom. Versions follow [semver](https://semver.org): fixes bump the last
number, features the middle one. Production runs the newest `v*` tag; staging runs `master`.

## Unreleased

- If a new version comes out while you're playing, an "Update ready · Reload" button appears at the bottom. Tap it when you're ready; nothing reloads on its own.
- The zoom button is gone, so it no longer covers the bottom-right square. Double-tap or pinch the board to zoom (Ctrl+scroll on a computer).
- Updates install themselves. When you open the app, or come back after a while, it checks for a new version behind a short splash screen before showing anything.

## v0.1.3 (2026-10-09)

- "Sam played SUN" names the word most of Sam's new tiles went into, not whichever word happened to be found first.
- In a game, a player's dot pulses while they have the game open, so you can see who's there right now.

## v0.1.2 (2026-10-09)

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
- Invite-only accounts. Admins make unlimited single-use invites, share them as a link or code, see who used each
  one, and revoke unused ones.
- Push notifications for your turn, game starts and endings. Desktop works in a browser tab; phones use the
  installed app.
- Settings: display name, theme, test notification, sign out.
- The version in the bottom-right corner links to the source code for exactly that release.
