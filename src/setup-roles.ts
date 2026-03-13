import { Client, GatewayIntentBits, PermissionFlagsBits } from 'discord.js';
import { config } from './config';

const ROLES = [
  {
    name: 'Founder',
    color: 0xf1c40f, // Gold
    permissions: [PermissionFlagsBits.Administrator],
    hoist: true, // Show separately in member list
  },
  {
    name: 'Builder',
    color: 0x3498db, // Blue
    permissions: [
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.Connect,
      PermissionFlagsBits.Speak,
      PermissionFlagsBits.UseApplicationCommands,
      PermissionFlagsBits.AttachFiles,
      PermissionFlagsBits.EmbedLinks,
      PermissionFlagsBits.AddReactions,
      PermissionFlagsBits.CreatePublicThreads,
    ],
    hoist: true,
  },
  {
    name: 'Advisor',
    color: 0x9b59b6, // Purple
    permissions: [
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.Connect,
      PermissionFlagsBits.Speak,
      PermissionFlagsBits.UseApplicationCommands,
      PermissionFlagsBits.AddReactions,
    ],
    hoist: true,
  },
  {
    name: 'Guest',
    color: 0x95a5a6, // Gray
    permissions: [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.AddReactions,
    ],
    hoist: false,
  },
];

async function setupRoles() {
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  await client.login(config.discord.token);

  await new Promise<void>((resolve) => {
    client.once('ready', () => resolve());
  });

  const guild = client.guilds.cache.get(config.discord.guildId);
  if (!guild) {
    console.error('Guild not found!');
    process.exit(1);
  }

  console.log(`Connected to: ${guild.name}`);

  // Create roles (in reverse order so Founder ends up highest)
  for (const roleDef of [...ROLES].reverse()) {
    const existing = guild.roles.cache.find((r) => r.name === roleDef.name);
    if (existing) {
      console.log(`Role "${roleDef.name}" already exists, updating...`);
      await existing.edit({
        color: roleDef.color,
        permissions: roleDef.permissions,
        hoist: roleDef.hoist,
      });
    } else {
      await guild.roles.create({
        name: roleDef.name,
        color: roleDef.color,
        permissions: roleDef.permissions,
        hoist: roleDef.hoist,
        reason: 'PayPal Mafia Bot setup',
      });
      console.log(`Created role: ${roleDef.name}`);
    }
  }

  // Assign Founder role to guild owner
  try {
    const owner = await guild.fetchOwner();
    const founderRole = guild.roles.cache.find((r) => r.name === 'Founder');
    if (founderRole && owner) {
      await owner.roles.add(founderRole);
      console.log(`Assigned Founder role to ${owner.user.tag}`);
    }
  } catch (err) {
    console.log('Could not assign Founder to owner:', err);
  }

  console.log('\n✅ Roles created successfully!');
  client.destroy();
  process.exit(0);
}

setupRoles().catch((err) => {
  console.error('Setup failed:', err);
  process.exit(1);
});
