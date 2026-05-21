import {QwenAiAdapter, QwenAiStreamHandler} from '../main/proxy/adapters/qwen-ai';
import {sessionStore} from '../sessionStore';
import type {SessionMessage} from '../sessionStore';
import {estimateTokens, extractText} from './textUtils';

export interface RollingSummaryOptions {
  maxSummaryTokens?: number;
  maxInputTokens?: number;
  maxMessageChars?: number;
  includeSystemMessages?: boolean;
}

function looksLikeClientProtocolNoise(text: string): boolean {
  return /# Tools\s*\n/i.test(text)
    || /Tool Use Formatting/i.test(text)
    || /UPDATING TASK PROGRESS/i.test(text)
    || /ACT MODE V\.S\. PLAN MODE/i.test(text)
    || /<tool_name>\s*\n<parameter/i.test(text);
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n[truncated ${text.length - maxChars} chars]`;
}

function prepareMessages(
  messages: SessionMessage[],
  options: Required<Pick<RollingSummaryOptions, 'maxInputTokens' | 'maxMessageChars' | 'includeSystemMessages'>>,
): string {
  const rendered: string[] = [];
  let tokenBudget = Math.max(options.maxInputTokens - 250, 1000);

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message) continue;
    const role = String(message.role || '').toLowerCase();
    const text = extractText(message.content).trim();
    if (!text) continue;
    if ((role === 'system' || role === 'tool') && !options.includeSystemMessages) continue;
    if (looksLikeClientProtocolNoise(text)) continue;

    const content = truncateText(text, options.maxMessageChars);
    const line = `${role.toUpperCase()}: ${content}`;
    const lineTokens = estimateTokens(line);
    if (lineTokens > tokenBudget && rendered.length > 0) break;
    rendered.unshift(line);
    tokenBudget -= lineTokens;
    if (tokenBudget <= 0) break;
  }

  return rendered.join('\n\n') || '(no recent user/assistant messages after filtering protocol noise)';
}

export async function updateRollingSummary(
  sessionId: string,
  recentMessages: SessionMessage[],
  currentSummary: string,
  adapter: QwenAiAdapter,
  model: string,
  optionsOrMaxTokens: RollingSummaryOptions | number = 800,
): Promise<void> {
  const options: Required<RollingSummaryOptions> = typeof optionsOrMaxTokens === 'number'
    ? {
      maxSummaryTokens: optionsOrMaxTokens,
      maxInputTokens: 6000,
      maxMessageChars: 3000,
      includeSystemMessages: false,
    }
    : {
      maxSummaryTokens: Number(optionsOrMaxTokens.maxSummaryTokens) || 800,
      maxInputTokens: Number(optionsOrMaxTokens.maxInputTokens) || 6000,
      maxMessageChars: Number(optionsOrMaxTokens.maxMessageChars) || 3000,
      includeSystemMessages: optionsOrMaxTokens.includeSystemMessages === true,
    };
  const recentText = prepareMessages(recentMessages, options);
  const prompt = [
    'Summarize this conversation state concisely for future turns.',
    `Keep the summary under ${options.maxSummaryTokens} tokens.`,
    'Preserve user goals, decisions, constraints, open tasks, important file paths, and unresolved errors.',
    '',
    'Previous summary:',
    truncateText(currentSummary || '(none)', Math.min(options.maxMessageChars, 4000)),
    '',
    'Recent messages:',
    recentText,
  ].join('\n');

  const promptTokens = estimateTokens(prompt);
  if (promptTokens > options.maxInputTokens) {
    console.warn('[Session] Rolling summary prompt still exceeds cap after filtering:', promptTokens, '/', options.maxInputTokens);
  }

  const {response} = await adapter.chatCompletion({
    model,
    messages: [{role: 'user', content: prompt}],
    stream: false,
  } as any);
  const handler = new QwenAiStreamHandler(model);
  const parsed = await handler.handleNonStream(response.data);
  const summary = parsed?.choices?.[0]?.message?.content
    || parsed?.choices?.[0]?.message?.reasoning_content
    || '';
  if (summary.trim()) {
    await sessionStore.setSummary(sessionId, summary.trim());
  }
}
