import { config } from './config';
import { registerCommands } from './core/command-registry';
import { projectsModule } from './modules/projects';
import { linksModule } from './modules/links';
import { githubModule } from './modules/github';
import { linearModule } from './modules/linear';
import { standupModule } from './modules/standup';
import { pulseModule } from './modules/pulse';
import { ideasModule } from './modules/ideas';
import { pollsModule } from './modules/polls';
import { decisionsModule } from './modules/decisions';
import { focusModule } from './modules/focus';
import { autoBookmarkModule } from './modules/auto-bookmark';
import { deployModule } from './modules/deploy';

const modules = [
  projectsModule,
  linksModule,
  githubModule,
  linearModule,
  standupModule,
  pulseModule,
  ideasModule,
  pollsModule,
  decisionsModule,
  focusModule,
  autoBookmarkModule,
  deployModule,
];

registerCommands(
  modules,
  config.discord.token,
  config.discord.clientId,
  config.discord.guildId,
).then(() => {
  console.log('Commands deployed successfully!');
  process.exit(0);
}).catch((err) => {
  console.error('Failed to deploy commands:', err);
  process.exit(1);
});
