import path from 'path';
import fs from 'fs';
import { QwenAiAdapter, QwenAiStreamHandler } from '../main/proxy/adapters/qwen-ai';
import { configStore } from '../configStore';
import { sessionStore } from '../sessionStore';
import { uploadOverflowFileToQwen } from './ossUploader';

export async function compactSession(sessionId: string, token: string, cookies: string): Promise<string> {
  const session = sessionStore.getSession(sessionId);
  if (!session || session.messages.length === 0) throw new Error('Session empty or not found');

  const conf = configStore.getConfig();
  const sessionCfg = conf.settings?.session || {};
  const compactModel = sessionCfg.compactModel || 'Qwen3.6-Plus';
  const keepRecent = Number(sessionCfg.compactKeepRecent) || 5;

  const parts: string[] = [];
  parts.push('# Proxy-Luna compact session conversation');
  parts.push(`Session: ${session.id} Source: ${session.source} Thread: ${session.threadId}`);
  parts.push('');
  for (let i = 0; i < session.messages.length; i++) {
    const m = session.messages[i];
    const content = typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '', null, 2);
    parts.push('-----');
    parts.push(`MESSAGE_INDEX: ${i}`);
    parts.push(`ROLE: ${m.role}`);
    parts.push('BEGIN MESSAGE');
    parts.push(content);
    parts.push('END MESSAGE');
    parts.push('');
  }
  const dir = path.join(process.cwd(), 'data', 'compact');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, {recursive: true});
  const fileName = `session-${session.id}-${Date.now()}.txt`;
  const filePath = path.join(dir, fileName);
  const fileContent = parts.join('\n');
  fs.writeFileSync(filePath, fileContent, 'utf8');

  const uploaded = await uploadOverflowFileToQwen(fileName, fileContent, token, cookies);

  const provider = new QwenAiAdapter(
    {id: 'qwen-ai', apiEndpoint: 'https://chat.qwen.ai', chatPath: '/api/v2/chat/completions'} as any,
    {id: 'compact', providerId: 'qwen-ai', name: 'compact', credentials: {token, cookies}} as any,
  );
  const compactPrompt = `Read the attached conversation history file and provide a concise summary of:
- The user's original request / active task
- Decisions and conclusions reached so far
- Important files, paths, or code referenced
- Errors or issues still pending
- The current state of the conversation
Do NOT repeat the conversation verbatim. Keep the summary under 500 words.`;
  const {response: compactResponse} = await provider.chatCompletion({
    model: compactModel,
    messages: [{role: 'user', content: compactPrompt}],
    stream: false,
    files: [{
      file_id: uploaded.fileId,
      url: uploaded.fileUrl,
      file_url: uploaded.fileUrl,
      filename: fileName,
      file_name: fileName,
      name: fileName,
      filetype: 'file',
      file_type: 'text/plain',
    }],
    file_ids: [uploaded.fileId],
  } as any);
  const handler = new QwenAiStreamHandler(compactModel);
  const result = await handler.handleNonStream(compactResponse.data);
  const summary = result?.choices?.[0]?.message?.content || '';
  if (!summary) throw new Error('Compact produced empty summary');

  sessionStore.setSummary(sessionId, summary);
  const recentMessages = session.messages.slice(-keepRecent);
  session.messages = recentMessages;
  session.updatedAt = Date.now();
  sessionStore.save();

  console.log('[Session] Compacted session', sessionId, '->', summary.slice(0, 100) + '...');
  return summary;
}
