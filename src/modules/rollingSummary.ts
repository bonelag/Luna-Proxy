import {QwenAiAdapter, QwenAiStreamHandler} from '../main/proxy/adapters/qwen-ai';
import {sessionStore} from '../sessionStore';
import type {SessionMessage} from '../sessionStore';

function renderMessages(messages: SessionMessage[]): string {
  return messages.map(message => {
    const content = typeof message.content === 'string'
      ? message.content
      : JSON.stringify(message.content || '');
    return `${message.role.toUpperCase()}: ${content}`;
  }).join('\n\n');
}

export async function updateRollingSummary(
  sessionId: string,
  recentMessages: SessionMessage[],
  currentSummary: string,
  adapter: QwenAiAdapter,
  model: string,
  maxTokens = 800,
): Promise<void> {
  const prompt = [
    'Summarize this conversation state concisely for future turns.',
    `Keep the summary under ${maxTokens} tokens.`,
    'Preserve user goals, decisions, constraints, open tasks, important file paths, and unresolved errors.',
    '',
    'Previous summary:',
    currentSummary || '(none)',
    '',
    'Recent messages:',
    renderMessages(recentMessages),
  ].join('\n');

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
