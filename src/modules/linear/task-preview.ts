import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import type { IssueMetadata } from '../../core/ai';

export function extractTldr(description: string): string {
  const match = description.match(/##\s*TL;?DR\s*\n+(.+)/i);
  return match ? match[1].trim() : '';
}

const PRIORITY_LABEL: Record<number, string> = {
  1: '🔴 Urgente',
  2: '🟠 Alta',
  3: '🟡 Média',
  4: '🟢 Baixa',
};

export function buildPreviewEmbed(
  title: string,
  originalTitle: string,
  description: string | undefined,
  metadata: IssueMetadata,
  username: string,
  projectName: string,
): EmbedBuilder {
  const tldr = description ? extractTldr(description) : '';
  const titleChanged = title !== originalTitle;

  const embed = new EmbedBuilder()
    .setTitle(`📋 ${title}`)
    .setColor(0x5e6ad2)
    .setDescription(
      [
        tldr ? `> ${tldr}` : null,
        titleChanged ? `\n*Título reformatado de: "${originalTitle}"*` : null,
      ]
        .filter(Boolean)
        .join('\n') || null,
    )
    .addFields(
      { name: '⚡ Prioridade', value: PRIORITY_LABEL[metadata.priority] || '🟡 Média', inline: true },
      { name: '🎯 Estimativa', value: `${metadata.estimate} pts`, inline: true },
      { name: '🏷️ Labels', value: metadata.labels.join(', ') || 'nenhum', inline: true },
      { name: '📁 Projeto', value: projectName, inline: true },
      { name: '👤 Solicitado por', value: username, inline: true },
    )
    .setFooter({ text: 'Confirme para criar no Linear • Cancela em 5 minutos' });

  return embed;
}

export function buildConfirmRow(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('task_confirm')
      .setLabel('✅ Confirmar')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('task_cancel')
      .setLabel('❌ Cancelar')
      .setStyle(ButtonStyle.Secondary),
  );
}
