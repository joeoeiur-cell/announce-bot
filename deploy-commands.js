require('dotenv').config();
const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const config = require('./config.json');

const presetChoices = Object.keys(config.presets).map(key => ({ name: key, value: key }));

const commands = [
  new SlashCommandBuilder()
    .setName('announce')
    .setDescription('Send a customizable announcement')
    .addStringOption(option =>
      option.setName('message')
        .setDescription('The announcement text')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('title')
        .setDescription('Title of the announcement')
        .setRequired(false))
    .addStringOption(option =>
      option.setName('preset')
        .setDescription('Pick a style preset (overrides color unless you set a custom color too)')
        .setRequired(false)
        .addChoices(...presetChoices))
    .addStringOption(option =>
      option.setName('color')
        .setDescription('Hex color, e.g. #ff0000')
        .setRequired(false))
    .addChannelOption(option =>
      option.setName('channel')
        .setDescription('Channel to post in (defaults to current channel)')
        .setRequired(false))
    .addStringOption(option =>
      option.setName('image')
        .setDescription('Image URL to attach to the announcement')
        .setRequired(false))
    .addBooleanOption(option =>
      option.setName('ping_everyone')
        .setDescription('Ping @everyone with this announcement')
        .setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .toJSON(),
];

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log(`Registering ${commands.length} slash command(s)...`);

    if (process.env.GUILD_ID) {
      // Instant update, scoped to one server — best for testing
      await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
        { body: commands },
      );
      console.log('Commands registered to guild (instant).');
    } else {
      // Global update — can take up to an hour to propagate
      await rest.put(
        Routes.applicationCommands(process.env.CLIENT_ID),
        { body: commands },
      );
      console.log('Commands registered globally (may take up to 1 hour).');
    }
  } catch (error) {
    console.error(error);
  }
})();
