import { GoogleGenerativeAI } from '@google/generative-ai';
import { createLogger } from './logger';

const logger = createLogger('ai');

const ISSUE_TEMPLATE_PROMPT = `Você é um assistente de product management para uma startup. Quando receber um título de issue/tarefa, gere uma descrição estruturada em Markdown seguindo EXATAMENTE este template:

## TL;DR
Uma frase resumindo o problema/objetivo. Direto ao ponto.

## Context
- Estado atual (números, métricas se aplicável)
- Como chegamos aqui (contexto do título)
- Dados que suportam a decisão

## Gaps / Problem Breakdown

| Severidade | Item | Notas |
|------------|------|-------|
| 🔴 Critical | Nome técnico | Descrição curta do gap/problema |
| 🟡 Medium | Nome técnico | Descrição curta |
| 🟢 Low | Nome técnico | Nice-to-have |

## Viabilidade

**Pode ser feito:**
| Ação | Esforço | Notas |
|------|---------|-------|
| Ação 1 | Low/Medium/High | Detalhes |

**Fora de escopo (e por quê):**
- Item fora de escopo — justificativa técnica

## Acceptance Criteria
- [ ] Critério verificável 1
- [ ] Critério verificável 2
- [ ] Critério verificável 3
- [ ] Documentar o que ficou de fora e por quê

---
Princípios que você DEVE seguir:
1. Data-driven: Abra com números quando possível
2. Tabelas > prosa: Gaps, tarefas, comparações — tudo em tabela
3. Severidade visual: Use 🔴 Critical, 🟡 Medium, 🟢 Low
4. Scope honesto: Declare explicitamente o que está fora de escopo
5. Esforço estimado: Cada item classificado como Low/Medium/High
6. Acceptance criteria binários: Cada critério é verificável (sim/não)
7. Seja conciso — máximo 400 palavras total
8. Escreva em português brasileiro
9. NÃO inclua o título da issue na resposta, só a descrição
10. Infira o contexto a partir do título — use bom senso de startup`;

let genAI: GoogleGenerativeAI | null = null;

export function initAI(): boolean {
  const apiKey = process.env['GEMINI_API_KEY'];
  if (!apiKey) {
    logger.warn('GEMINI_API_KEY not set — AI features disabled');
    return false;
  }
  genAI = new GoogleGenerativeAI(apiKey);
  logger.info('Gemini AI initialized');
  return true;
}

export async function generateIssueDescription(title: string, projectName?: string): Promise<string | null> {
  if (!genAI) return null;

  try {
    const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

    const contextHint = projectName ? `\nProjeto: ${projectName}` : '';
    const prompt = `${ISSUE_TEMPLATE_PROMPT}\n\nGere a descrição para esta issue:\nTítulo: ${title}${contextHint}`;

    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();

    logger.info(`AI generated description for: ${title} (${text.length} chars)`);
    return text;
  } catch (error) {
    logger.error('AI generation failed:', error);
    return null;
  }
}
