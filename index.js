require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');

const configPath = path.join(__dirname, 'config.json');
let config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// Reload config live if it's edited while the bot is running
fs.watchFile(configPath, () => {
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    console.log('config.json reloaded.');
  } catch (err) {
    console.error('Failed to reload config.json:', err);
  }
});

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once('clientReady', () => {
  console.log(`${config.botName} is online as ${client.user.tag}`);
});

function hasPermission(interaction) {
  const member = interaction.member;
  if (!member) return false;

  if (config.allowedRoleIds && config.allowedRoleIds.length > 0) {
    return config.allowedRoleIds.some(roleId => member.roles.cache.has(roleId));
  }

  return member.permissions.has(PermissionFlagsBits.ManageMessages);
}

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'announce') return;

  if (!hasPermission(interaction)) {
    await interaction.reply({
      content: "You don't have permission to send announcements.",
      ephemeral: true,
    });
    return;
  }

  const message = interaction.options.getString('message');
  const title = interaction.options.getString('title');
  const presetName = interaction.options.getString('preset');
  const customColor = interaction.options.getString('color');
  const channelOption = interaction.options.getChannel('channel');
  const image = interaction.options.getString('image');
  const pingEveryone = interaction.options.getBoolean('ping_everyone') || false;

  const preset = presetName ? config.presets[presetName] : null;

  let color = config.defaultColor;
  if (preset) color = preset.color;
  if (customColor) color = customColor;

  if (!/^#([0-9A-F]{3}){1,2}$/i.test(color)) {
    color = config.defaultColor;
  }

  const embedTitle = title
    ? `${preset ? preset.emoji + ' ' : ''}${title}`
    : `${preset ? preset.emoji + ' ' : ''}${config.botName}`;

  const embed = new EmbedBuilder()
    .setTitle(embedTitle)
    .setDescription(message)
    .setColor(color)
    .setTimestamp()
    .setFooter({
      text: config.footerText,
      iconURL: config.footerIconUrl || undefined,
    });

  if (config.thumbnailUrl) embed.setThumbnail(config.thumbnailUrl);
  if (image) embed.setImage(image);

  const targetChannel = channelOption || interaction.channel;

  const canPing = pingEveryone && config.mentionOptions.everyone;
  const content = canPing ? '@everyone' : undefined;

  try {
    await targetChannel.send({
      content,
      embeds: [embed],
      allowedMentions: { parse: canPing ? ['everyone'] : [] },
    });

    await interaction.reply({
      content: `Announcement sent to ${targetChannel}.`,
      ephemeral: true,
    });
  } catch (err) {
    console.error(err);
    await interaction.reply({
      content: "Couldn't send that announcement. Check that I have permission to post in that channel.",
      ephemeral: true,
    });
  }
});

client.login(process.env.DISCORD_TOKEN);

module.exports = { client, getConfig: () => config, configPath };
