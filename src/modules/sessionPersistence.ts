import crypto from 'crypto';
import { configStore } from '../configStore';
import { sessionStore } from '../sessionStore';
import type { SessionMessage } from '../sessionStore';
import { estimateTokens, extractText } from './textUtils';
import { stripThinkingBlocks, isAssistantFailureEcho, messageSimilarity } from '../main/proxy/overflowSanitizer';
import { compactSession } from './sessionCompactor';
import { updateRollingSummary } from './rollingSummary';
import { QwenAiAdapter } from '../main/proxy/adapters/qwen-ai';
import type { Provider } from '../main/store/types';

const compactingNow = new Set<string>();

function isProtocolSystemMessage(role: string, text: string): boolean {
  return role === 'system' && (
    /# Tools\s*\n/i.test(text)
    || /Tool Use Formatting/i.test(text)
    || /UPDATING TASK PROGRESS/i.test(text)
    || /ACT MODE V\.S\. PLAN MODE/i.test(text)
    || /<tool_name>\s*\n<parameter/i.test(text)
  );
}

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
  const overflowFileIds = Array.isArray(overflowResult?.fileIds) ? overflowResult.fileIds : [];
  const overflowFiles = Array.isArray(overflowResult?.files) ? overflowResult.files : [];
  const shouldPersistOverflowAnchorOnly = overflowFileIds.length > 0;

  if (shouldPersistOverflowAnchorOnly) {
    skippedMessages += Array.isArray(incomingMessages) ? incomingMessages.length : 0;
    const overflowFileName = overflowResult?.sanitizerMeta?.overflowFile
      || overflowFiles[0]?.filename
      || overflowFiles[0]?.file_name
      || overflowFileIds[0];
    const preview = overflowResult?.sanitizerMeta?.activeTask?.textPreview || '';
    sessionMessages.push({
      id: crypto.randomUUID(),
      role: 'user',
      content: [
        '[overflow prompt stored as file]',
        `file: ${overflowFileName}`,
        `file_id: ${overflowFileIds[0]}`,
        preview ? `latest_user_preview: ${preview}` : '',
      ].filter(Boolean).join('\n'),
      createdAt: now,
      tokenEstimate: estimateTokens(preview) + 20,
      runId: meta?.runId,
      providerId: meta?.providerId,
      accountId: meta?.accountId,
      workerId: meta?.workerId,
      providerSessionId: meta?.providerSessionId,
    });
  } else {
    for (const msg of incomingMessages) {
      if (!msg || !msg.role) continue;
      const text = extractText(msg.content);
      if (isProtocolSystemMessage(String(msg.role).toLowerCase(), text)) {
        skippedMessages++;
        continue;
      }
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

  const session = sessionStore.getSession(sessionId);
  const summaryEveryNTurns = Number(sessionCfg.summaryEveryNTurns) || 5;
  const turnCount = session?.turnCount || 0;
  if (session && summaryEveryNTurns > 0 && turnCount > 0 && turnCount % summaryEveryNTurns === 0) {
    const providerConf = conf.providers.find(p => p.id === 'qwen-ai');
    const token = (providerConf?.credentials?.token) || process.env.QWEN_AI_TOKEN || '';
    const cookies = (providerConf?.credentials?.cookies || providerConf?.credentials?.cookie) || process.env.QWEN_AI_COOKIES || '';
    if (token || cookies) {
      const provider: Provider = {
        id: 'qwen-ai',
        apiEndpoint: 'https://chat.qwen.ai',
        chatPath: '/api/v2/chat/completions',
      } as Provider;
      const adapter = new QwenAiAdapter(provider, {id: 'summary', providerId: 'qwen-ai', name: 'summary', credentials: {token, cookies}} as any);
      updateRollingSummary(
        sessionId,
        sessionStore.getRecentMessages(sessionId, Math.max(historyLimit * 2, Number(sessionCfg.rollingHistoryK) || 10)),
        session.summary || '',
        adapter,
        session.model || sessionCfg.compactModel || 'Qwen3.6-Plus',
        {
          maxSummaryTokens: Number(sessionCfg.summaryMaxTokens) || 800,
          maxInputTokens: Number(sessionCfg.summaryInputMaxTokens) || 6000,
          maxMessageChars: Number(sessionCfg.summaryMessageMaxChars) || 3000,
          includeSystemMessages: sessionCfg.summaryIncludeSystemMessages === true,
        },
      ).catch(err => console.error('[Session] Rolling summary failed:', err));
    }
  }

  if (sessionCfg.autoCompact !== false && sessionStore.getMessageCount(sessionId) >= Number(sessionCfg.compactAfterMessages || 40)) {
    const providerConf = conf.providers.find(p => p.id === 'qwen-ai');
    const token = (providerConf?.credentials?.token) || process.env.QWEN_AI_TOKEN || '';
    const cookies = (providerConf?.credentials?.cookies || providerConf?.credentials?.cookie) || process.env.QWEN_AI_COOKIES || '';
    if (token || cookies) {
      if (!compactingNow.has(sessionId)) {
        compactingNow.add(sessionId);
        compactSession(sessionId, token, cookies)
          .catch(err => console.error('[Session] Auto-compact failed:', err))
          .finally(() => compactingNow.delete(sessionId));
      } else {
        console.log('[Session] Compact already in progress for', sessionId, '- skipping');
      }
    }
  }
}
