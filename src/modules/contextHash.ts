import crypto from 'crypto';

export function computeInboundContextHash(messages: any[], model: string): string {
  if (!Array.isArray(messages) || messages.length <= 1) return '';
  return hashMessages(messages.slice(0, -1), model);
}

export function computeOutboundContextHash(messages: any[], responseText: string, model: string): string {
  if (!Array.isArray(messages) || !responseText) return '';
  return hashMessages([...messages, {role: 'assistant', content: responseText}], model);
}

function hashMessages(messages: any[], model: string): string {
  const parts = messages.map(message => {
    const role = String(message?.role || '').toLowerCase();
    const content = typeof message?.content === 'string'
      ? message.content
      : JSON.stringify(message?.content || '');
    return `${role}:${content.slice(0, 4000)}`;
  });
  return crypto
    .createHash('sha256')
    .update(`${model}::${parts.join('||')}`, 'utf8')
    .digest('hex')
    .slice(0, 32);
}
