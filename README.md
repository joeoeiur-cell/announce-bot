# Announce Bot

A customizable Discord announcement bot with a `/announce` slash command — pick a color, title, image, style preset, target channel, and optional @everyone ping.

## Setup

1. **Create a Discord application & bot**
   - Go to https://discord.com/developers/applications → New Application
   - Go to the "Bot" tab → Add Bot → copy the **token**
   - Go to "OAuth2" → General → copy the **Client ID**
   - Under "Bot" tab, no privileged intents are needed for this bot

2. **Invite the bot to your server**
   - OAuth2 → URL Generator → scopes: `bot`, `applications.commands`
   - Bot permissions: `Send Messages`, `Embed Links`, `Mention Everyone` (optional)
   - Open the generated URL and add it to your server

3. **Install dependencies**
   ```
   npm install
   ```

4. **Configure secrets**
   - Rename `.env.example` to `.env`
   - Fill in `DISCORD_TOKEN`, `CLIENT_ID`, and (optionally) `GUILD_ID` for your test server — guild-scoped commands update instantly, global commands take up to an hour

5. **Register the slash command**
   ```
   npm run deploy
   ```

6. **Start the bot**
   ```
   npm start
   ```

## Customizing

Everything visual/behavioral lives in `config.json` — edit it anytime, changes apply live without restarting:

- `defaultColor` — hex color used when no preset/color is picked
- `footerText` / `footerIconUrl` — embed footer
- `thumbnailUrl` — small image in the corner of every announcement
- `allowedRoleIds` — array of role IDs allowed to use `/announce`. Leave empty to just require "Manage Messages" permission
- `presets` — named style shortcuts (info/success/warning/alert/event by default) with their own color + emoji. Add your own or edit existing ones
- `mentionOptions.everyone` — must be `true` for the `ping_everyone` command option to actually ping

## Using it

In any channel the bot can see:
```
/announce message: "Server maintenance tonight at 9PM EST" title: "Maintenance" preset: warning ping_everyone: true
```

Options:
- `message` (required) — the announcement body
- `title` — custom title, otherwise uses bot name
- `preset` — info / success / warning / alert / event (adds an emoji + color)
- `color` — custom hex color, overrides preset color
- `channel` — post to a different channel than the one you're in
- `image` — image URL shown in the embed
- `ping_everyone` — ping @everyone (only works if enabled in config)
