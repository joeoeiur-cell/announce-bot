require('dotenv').config();
const express = require('express');
const cookieSession = require('cookie-session');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EmbedBuilder } = require('discord.js');

// Boots the existing bot (index.js) and gives us access to its live client + config
const { client, configPath } = require('./index.js');

const app = express();
app.use(express.json({ limit: '2mb' }));

// Serve static frontend files BEFORE custom route fallbacks
app.use(express.static(path.join(__dirname, 'public')));

const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || 'changeme';

app.use(
  cookieSession({
    name: 'session',
    secret: SESSION_SECRET,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    sameSite: 'lax',
  })
);

function requireAuth(req, res, next) {
  if (req.session && req.session.authed) return next();
  return res.status(401).json({ error: 'Not authenticated' });
}

// ---------- config.json read/write ----------
function readConfig() {
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

function writeConfig(next) {
  const required = ['botName', 'defaultColor', 'footerText', 'presets', 'mentionOptions'];
  for (const key of required) {
    if (!(key in next)) throw new Error(`Config is missing required field: ${key}`);
  }
  if (!/^#([0-9A-F]{3}){1,2}$/i.test(next.defaultColor)) {
    throw new Error('defaultColor must be a valid hex color');
  }
  fs.writeFileSync(configPath, JSON.stringify(next, null, 2));
}

// ---------- Auth ----------
app.post('/api/login', (req, res) => {
  const { password } = req.body || {};
  if (password && password === DASHBOARD_PASSWORD) {
    req.session.authed = true;
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: 'Incorrect password' });
});

app.post('/api/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

app.get('/api/session', (req, res) => {
  res.json({ authed: !!(req.session && req.session.authed) });
});

// ---------- Bot status ----------
app.get('/api/bot/status', requireAuth, (req, res) => {
  const ready = client.isReady();
  res.json({
    ready,
    info: ready
      ? {
          tag: client.user.tag,
          username: client.user.username,
          avatar: client.user.displayAvatarURL({ size: 256 }),
        }
      : null,
  });
});

app.get('/api/guilds', requireAuth, (req, res) => {
  if (!client.isReady()) return res.json([]);
  res.json(
    client.guilds.cache.map((g) => ({
      id: g.id,
      name: g.name,
      icon: g.iconURL({ size: 128 }) || null,
      memberCount: g.memberCount,
    }))
  );
});

app.get('/api/guilds/:guildId/channels', requireAuth, async (req, res) => {
  try {
    const guild = await client.guilds.fetch(req.params.guildId);
    const channels = await guild.channels.fetch();
    res.json(
      channels
        .filter((c) => c && (c.type === 0 || c.type === 5))
        .map((c) => ({ id: c.id, name: c.name }))
    );
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/guilds/:guildId/roles', requireAuth, async (req, res) => {
  try {
    const guild = await client.guilds.fetch(req.params.guildId);
    const roles = await guild.roles.fetch();
    res.json(
      roles
        .filter((r) => r.name !== '@everyone')
        .sort((a, b) => b.position - a.position)
        .map((r) => ({ id: r.id, name: r.name, color: r.hexColor }))
    );
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- Config: read/update ----------
app.get('/api/config', requireAuth, (req, res) => {
  res.json(readConfig());
});

app.put('/api/config', requireAuth, (req, res) => {
  try {
    writeConfig(req.body);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.put('/api/config/presets/:key', requireAuth, (req, res) => {
  const { color, emoji } = req.body || {};
  if (!color || !/^#([0-9A-F]{3}){1,2}$/i.test(color)) {
    return res.status(400).json({ error: 'A valid hex color is required' });
  }
  const cfg = readConfig();
  cfg.presets[req.params.key] = { color, emoji: emoji || '' };
  writeConfig(cfg);
  res.json({ ok: true });
});

app.delete('/api/config/presets/:key', requireAuth, (req, res) => {
  const cfg = readConfig();
  delete cfg.presets[req.params.key];
  writeConfig(cfg);
  res.json({ ok: true });
});

// ---------- Send announcement ----------
app.post('/api/announce/send', requireAuth, async (req, res) => {
  if (!client.isReady()) return res.status(503).json({ error: 'Bot is not connected yet' });

  const { channelId, message, title, presetKey, color: customColor, image, pingEveryone } = req.body || {};
  if (!channelId || !message) {
    return res.status(400).json({ error: 'channelId and message are required' });
  }

  const cfg = readConfig();
  const preset = presetKey ? cfg.presets[presetKey] : null;

  let color = cfg.defaultColor;
  if (preset) color = preset.color;
  if (customColor) color = customColor;
  if (!/^#([0-9A-F]{3}){1,2}$/i.test(color)) color = cfg.defaultColor;

  const embedTitle = title
    ? `${preset ? preset.emoji + ' ' : ''}${title}`
    : `${preset ? preset.emoji + ' ' : ''}${cfg.botName}`;

  const embed = new EmbedBuilder()
    .setTitle(embedTitle)
    .setDescription(message)
    .setColor(color)
    .setTimestamp()
    .setFooter({
      text: cfg.footerText,
      iconURL: cfg.footerIconUrl || undefined,
    });

  if (cfg.thumbnailUrl) embed.setThumbnail(cfg.thumbnailUrl);
  if (image) embed.setImage(image);

  const canPing = !!pingEveryone && cfg.mentionOptions.everyone;

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
      return res.status(400).json({ error: 'Channel not found or not a text channel' });
    }
    await channel.send({
      content: canPing ? '@everyone' : undefined,
      embeds: [embed],
      allowedMentions: { parse: canPing ? ['everyone'] : [] },
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- Catch-all for SPA Single Page App ----------
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Listen on 0.0.0.0 so Railway can bind to all network interfaces
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Dashboard running on port ${PORT}`);
});
