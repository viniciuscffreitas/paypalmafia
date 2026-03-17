import { GoogleGenerativeAI } from '@google/generative-ai';
import type { PlaceResult, ScoreResult } from './types';
import { createLogger } from '../../core/logger';

const logger = createLogger('leads:ai');

export function buildAnalysisPrompt(place: PlaceResult, score: ScoreResult): string {
  return `Você é um consultor de vendas para serviços de desenvolvimento web e software.
Analise este estabelecimento como potencial cliente:

- Nome: ${place.name}
- Categoria: ${place.category || 'N/A'}
- Rating: ${place.rating ?? 'N/A'} (${place.review_count} avaliações)
- Site: ${place.website || 'nenhum'}
- Sinais detectados: ${score.signals.join(', ')}
- Serviço recomendado: ${score.recommended_service}

Serviços que oferecemos:
- vibe-web.com: Landing pages (€390+), sites multi-page com CMS (€490+), web apps/dashboards (€2,490+)
- vinicius.xyz: MVPs, automação de processos, integrações CRM/ERP, auditoria técnica

Responda EXATAMENTE neste formato (duas linhas):
ANÁLISE: [1-2 frases sobre a situação digital do negócio e a oportunidade]
PITCH: [1-2 frases de abordagem direta que eu possa usar como primeiro contato via WhatsApp/email]`;
}

export function parseAiResponse(raw: string): { analysis: string; pitch: string } {
  const analysisMatch = raw.match(/AN[ÁA]LISE:\s*(.+?)(?=\nPITCH:|$)/s);
  const pitchMatch = raw.match(/PITCH:\s*(.+?)$/s);

  if (analysisMatch && pitchMatch) {
    return {
      analysis: analysisMatch[1].trim(),
      pitch: pitchMatch[1].trim(),
    };
  }

  const mid = Math.floor(raw.length / 2);
  const splitAt = raw.lastIndexOf('.', mid);
  if (splitAt > 0 && splitAt < raw.length - 1) {
    return {
      analysis: raw.slice(0, splitAt + 1).trim(),
      pitch: raw.slice(splitAt + 1).trim(),
    };
  }

  return { analysis: raw.trim(), pitch: raw.trim() };
}

export async function enrichLead(
  genAI: GoogleGenerativeAI,
  place: PlaceResult,
  score: ScoreResult,
): Promise<{ analysis: string; pitch: string } | null> {
  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const prompt = buildAnalysisPrompt(place, score);
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    logger.info(`AI enriched lead: ${place.name} (${text.length} chars)`);
    return parseAiResponse(text);
  } catch (error) {
    logger.error(`AI enrichment failed for ${place.name}:`, error);
    return null;
  }
}
