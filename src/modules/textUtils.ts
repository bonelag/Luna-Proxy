export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

export function extractText(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(c => extractText(c)).join('\n');
  if (content && typeof content === 'object') {
    if (typeof content.text === 'string') return content.text;
    if (typeof content.content === 'string') return content.content;
    if (Array.isArray(content.parts)) return content.parts.map((p: any) => extractText(p)).join('\n');
    if (content.type === 'text' && typeof content.text === 'string') return content.text;
    return JSON.stringify(content);
  }
  return String(content ?? '');
}
