require('dotenv').config();
const express = require('express');
const cookieSession = require('cookie-session');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');

// Boots the existing bot (index.js) and gives us access to its live client + config
const { client, configPath } = require('./index.js');

const app = express();
app.use(express.json({ limit: '2mb' }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB — Discord's non-boosted attachment cap
  fileFilter: (req, file, cb) => {
    if (/^image\/(png|jpe?g|gif|webp)$/.test(file.mimetype)) cb(null, true);
    else cb(new Error('Only PNG, JPG, GIF, or WEBP images are allowed'));
  },
});

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

// ---------- Scheduled announcements (in-memory; cleared on restart) ----------
const scheduled = new Map(); // id -> { timer, payload, sendAt }

function scheduleAnnouncement(payload, sendAt) {
  const id = crypto.randomUUID();
  const delay = sendAt - Date.now();
  const timer = setTimeout(async () => {
    scheduled.delete(id);
    try {
      await sendAnnouncement(payload);
    } catch (e) {
      console.error(`Scheduled announcement ${id} failed:`, e.message);
    }
  }, delay);
  scheduled.set(id, { timer, payload, sendAt });
  return id;
}

// ---------- config.json read/write ----------
// The bot (index.js) watches this file and hot-reloads automatically on write.
function readConfig() {
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
}

function writeConfig(next) {
  // Basic shape guard so a bad request can't corrupt the file the bot depends on
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

// ---------- Config: read/update everything customizable ----------
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

// Presets: add/update/delete individually, so the dashboard doesn't need
// to round-trip the whole config object for small edits.
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

// ---------- Send announcement from the dashboard ----------
// Mirrors the exact embed-building logic in index.js's /announce handler,
// so a manual send looks identical to a slash-command send.
async function sendAnnouncement(payload) {
  const {
    channelId,
    message,
    title,
    presetKey,
    color: customColor,
    image,
    imageBuffer,
    imageName,
    author,
    pingEveryone,
    pingHere,
    mentionRoleIds,
  } = payload;

  if (!client.isReady()) throw new Error('Bot is not connected yet');

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

  if (author) embed.setAuthor({ name: author });
  if (cfg.thumbnailUrl) embed.setThumbnail(cfg.thumbnailUrl);

  const files = [];
  if (imageBuffer) {
    // Uploaded file: attach it and reference it via the attachment:// URI
    const safeName = (imageName || 'image.png').replace(/[^a-zA-Z0-9._-]/g, '_');
    files.push(new AttachmentBuilder(imageBuffer, { name: safeName }));
    embed.setImage(`attachment://${safeName}`);
  } else if (image) {
    embed.setImage(image);
  }

  const canPingEveryone = !!pingEveryone && cfg.mentionOptions.everyone;
  const canPingHere = !!pingHere && cfg.mentionOptions.here;
  const roleIds = Array.isArray(mentionRoleIds) ? mentionRoleIds.filter(Boolean) : [];

  const mentionParts = [];
  if (canPingEveryone) mentionParts.push('@everyone');
  else if (canPingHere) mentionParts.push('@here');
  roleIds.forEach((id) => mentionParts.push(`<@&${id}>`));

  const channel = await client.channels.fetch(channelId);
  if (!channel || !channel.isTextBased()) {
    throw new Error('Channel not found or not a text channel');
  }

  await channel.send({
    content: mentionParts.length ? mentionParts.join(' ') : undefined,
    embeds: [embed],
    files,
    allowedMentions: {
      parse: canPingEveryone ? ['everyone'] : canPingHere ? ['everyone'] : [],
      roles: roleIds,
    },
  });
}

function handleImageUpload(req, res, next) {
  upload.single('imageFile')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}

app.post('/api/announce/send', requireAuth, handleImageUpload, async (req, res) => {
  try {
    // multipart/form-data (file upload) sends fields as strings; JSON body sends them typed
    const body = req.is('multipart/form-data') ? req.body : req.body || {};
    const mentionRoleIds = body.mentionRoleIds
      ? typeof body.mentionRoleIds === 'string'
        ? JSON.parse(body.mentionRoleIds)
        : body.mentionRoleIds
      : [];

    const payload = {
      channelId: body.channelId,
      message: body.message,
      title: body.title,
      presetKey: body.presetKey,
      color: body.color,
      image: body.image,
      imageBuffer: req.file ? req.file.buffer : null,
      imageName: req.file ? req.file.originalname : null,
      author: body.author,
      pingEveryone: body.pingEveryone === true || body.pingEveryone === 'true',
      pingHere: body.pingHere === true || body.pingHere === 'true',
      mentionRoleIds,
    };

    if (!payload.channelId || !payload.message) {
      return res.status(400).json({ error: 'channelId and message are required' });
    }

    const sendAt = body.sendAt ? Number(body.sendAt) : null;
    if (sendAt && sendAt > Date.now() + 5000) {
      const id = scheduleAnnouncement(payload, sendAt);
      return res.json({ ok: true, scheduled: true, id, sendAt });
    }

    await sendAnnouncement(payload);
    res.json({ ok: true });
  } catch (e) {
    res.status(e.message === 'Bot is not connected yet' ? 503 : 500).json({ error: e.message });
  }
});

// ---------- Scheduled announcements: list / cancel ----------
app.get('/api/announce/scheduled', requireAuth, (req, res) => {
  res.json(
    Array.from(scheduled.entries()).map(([id, s]) => ({
      id,
      sendAt: s.sendAt,
      channelId: s.payload.channelId,
      title: s.payload.title,
      message: s.payload.message,
    }))
  );
});

app.delete('/api/announce/scheduled/:id', requireAuth, (req, res) => {
  const s = scheduled.get(req.params.id);
  if (!s) return res.status(404).json({ error: 'Not found' });
  clearTimeout(s.timer);
  scheduled.delete(req.params.id);
  res.json({ ok: true });
});

// ---------- Static frontend ----------
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Dashboard running on port ${PORT}`);
});
