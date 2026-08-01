# Announce Bot + Dashboard

Your original `/announce` slash-command bot, unchanged, plus a password-protected web dashboard that edits `config.json` and can also send announcements directly.

## What's different from your repo

- `index.js` — identical behavior. Only addition: it now exports `client` and `configPath` at the bottom so the dashboard can reuse the same Discord connection instead of opening a second one.
- `config.json`, `deploy-commands.js` — untouched.
- `server.js` — **new**. An Express app that requires `index.js` (starting the bot), serves the dashboard, and reads/writes `config.json`.
- `public/` — **new**. The dashboard itself.
- `package.json` — added `express` and `cookie-session`; `npm start` now runs `server.js` instead of `index.js` directly. `npm run bot-only` still runs just the bot with no dashboard, if you ever want that.

The bot already hot-reloads `config.json` via `fs.watchFile` — so any change made in the dashboard takes effect immediately, no restart needed. The dashboard doesn't reimplement that logic; it just writes the same file your bot already watches.

## Dashboard sections

- **Compose** — send an announcement from the browser. Builds the exact same embed shape as `/announce`, including preset + custom color logic, and shows a live Discord-style preview as you type.
- **Presets** — add, view, and delete entries in `config.presets`. These are the same choices available in `/announce preset:`.
- **Bot identity** — `botName`, `defaultColor`, `footerText`, `footerIconUrl`, `thumbnailUrl`.
- **Permissions & mentions** — manage `allowedRoleIds` (who can use `/announce`) and the `mentionOptions.everyone` / `.here` toggles.

## Setup

1. **Discord application** — same as before: create it in the [Developer Portal](https://discord.com/developers/applications), copy the bot token and client ID, invite it with `bot` + `applications.commands` scopes and `Send Messages`, `Embed Links`, `Mention Everyone` (optional) permissions.
2. **Install dependencies**
   ```
   npm install
   ```
3. **Configure secrets** — copy `.env.example` to `.env` and fill in `DISCORD_TOKEN`, `CLIENT_ID`, optionally `GUILD_ID`, plus the new `DASHBOARD_PASSWORD` and `SESSION_SECRET`.
4. **Register the slash command** (only needed once, or after changing its options)
   ```
   npm run deploy
   ```
5. **Start bot + dashboard together**
   ```
   npm start
   ```
   Opens on `http://localhost:3000`.

## Deploying to Railway

1. Push this folder to a GitHub repo, connect it to a new Railway project. Nixpacks detects Node automatically.
2. Add a **Volume** mounted at `/app` (or at least somewhere `config.json` lives) if you want dashboard edits to persist across redeploys — otherwise `config.json` resets to whatever's in your repo on every deploy. Simplest option: just commit `config.json` changes back to the repo when you're happy with them, and treat the dashboard as a live-editing tool between deploys.
3. Set environment variables in Railway: `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID` (optional), `DASHBOARD_PASSWORD`, `SESSION_SECRET`.
4. Deploy. Railway gives you a public URL — that's your dashboard.

## Notes

- Only one Discord connection is opened (by `index.js`); the dashboard reuses it rather than logging in separately.
- `/announce` in Discord and "Send announcement" in the dashboard produce identical output — same title/preset/color/footer/thumbnail logic.
- Permission checks for `/announce` itself are unchanged (`allowedRoleIds` or Manage Messages). The dashboard's own access control is just the password — anyone with the password can send from it and edit config, so treat that password like an admin credential.
