# Changelog

What changed in each release of Tileroom. Versions follow [semver](https://semver.org): fixes bump the last
number, features the middle one. Production runs the newest `v*` tag; staging runs `master`.

## Unreleased

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
