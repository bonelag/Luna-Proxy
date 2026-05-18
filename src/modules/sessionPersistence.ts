import crypto from 'crypto';
import { configStore } from '../configStore';
import { sessionStore } from '../sessionStore';
import type { SessionMessage } from '../sessionStore';
import { estimateTokens, extractText } from './textUtils';
import { stripThinkingBlocks, isAssistantFailureEcho, messageSimilarity } from '../main/proxy/overflowSanitizer';
import { compactSession } from './sessionCompactor';

export function persistSessionMessages(
  sessionId: string,
  incomingMessages: any[],
  response: any,
  overflowResult: {messages: any[]; fileIds: string[]; files: any[]; sanitized?: boolean; sanitizerMeta?: Record<string, any>},
  meta?: { runId?: string; providerId?: string; accountId?: string; workerId?: string; providerSessionId?: string },
): void {
  const sessionMessages: SessionMessage[] = [];
  const now = Date.now();
  let skippedMessages = 0;
  const existingMessages = sessionStore.getRecentMessages(sessionId, 1);
  const lastAssistantText = existingMessages.length > 0 && existingMessages[0].role === 'assistant'
    ? extractText(existingMessages[0].content) : null;

  for (const msg of incomingMessages) {
    if (!msg || !msg.role) continue;
    const text = extractText(msg.content);
    if (msg.role === 'assistant') {
      const cleanedText = stripThinkingBlocks(text);
      if (isAssistantFailureEcho(cleanedText)) {
        skippedMessages++;
        continue;
      }
      if (lastAssistantText && messageSimilarity(lastAssistantText, cleanedText, 'normalized-token-jaccard') >= 0.85) {
        skippedMessages++;
        continue;
      }
    }
    sessionMessages.push({
      id: crypto.randomUUID(),
      role: msg.role,
      content: msg.content,
      createdAt: now,
      tokenEstimate: estimateTokens(text),
      runId: meta?.runId,
      providerId: meta?.providerId,
      accountId: meta?.accountId,
      workerId: meta?.workerId,
      providerSessionId: meta?.providerSessionId,
    });
  }
  if (response) {
    const responseText = typeof response === 'string' ? response
      : response?.choices?.[0]?.message?.content
        || response?.choices?.[0]?.delta?.content
        || '';
    if (responseText) {
      const cleanedResponse = stripThinkingBlocks(responseText);
      if (!isAssistantFailureEcho(cleanedResponse)) {
        const lastMsg = sessionMessages.length > 0 ? sessionMessages[sessionMessages.length - 1] : null;
        if (lastMsg && lastMsg.role === 'assistant' && messageSimilarity(extractText(lastMsg.content), cleanedResponse, 'normalized-token-jaccard') >= 0.85) {
          skippedMessages++;
        } else {
          sessionMessages.push({
            id: crypto.randomUUID(),
            role: 'assistant',
            content: responseText,
            createdAt: now + 1,
            tokenEstimate: estimateTokens(responseText),
            runId: meta?.runId,
            providerId: meta?.providerId,
            accountId: meta?.accountId,
            workerId: meta?.workerId,
            providerSessionId: meta?.providerSessionId,
          });
        }
      }
    }
  }

  if (sessionMessages.length > 0) {
    sessionStore.appendMessages(sessionId, sessionMessages);
  }
  if (skippedMessages > 0) {
    const conf = configStore.getConfig();
    const skippedBatch = {
      skipped: skippedMessages,
      persisted: sessionMessages.length,
    };
    if (overflowResult) {
      overflowResult.sanitizerMeta = {
        ...(overflowResult.sanitizerMeta || {}),
        persistSkipped: skippedBatch,
      };
    }
  }
  const conf = configStore.getConfig();
  const sessionCfg = conf.settings?.session || {};
  const historyLimit = Number(sessionCfg.historyLimit) || 10;
  sessionStore.trimHistory(sessionId, historyLimit * 2);

  if (sessionCfg.autoCompact !== false && sessionStore.getMessageCount(sessionId) >= Number(sessionCfg.compactAfterMessages || 40)) {
    const providerConf = conf.providers.find(p => p.id === 'qwen-ai');
    const token = (providerConf?.credentials?.token) || process.env.QWEN_AI_TOKEN || '';
    const cookies = (providerConf?.credentials?.cookies || providerConf?.credentials?.cookie) || process.env.QWEN_AI_COOKIES || '';
    if (token || cookies) {
      compactSession(sessionId, token, cookies).catch(err => {
        console.error('[Session] Auto-compact failed:', err);
      });
    }
  }
}
