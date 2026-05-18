export function analyzeResponseXml(responseText: string): Record<string, any> | null {
  if (!responseText || typeof responseText !== 'string') return null;
  const xmlBlockRegex = /<(\w[\w-]*)\b[^>]*>[\s\S]*?<\/\1>/g;
  const allBlocks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = xmlBlockRegex.exec(responseText)) !== null) allBlocks.push(match[0]);
  const toolLikeBlocks = allBlocks.filter(b => {
    const tagMatch = b.match(/^<(\w[\w-]*)/);
    if (!tagMatch) return false;
    const name = tagMatch[1].toLowerCase();
    const nonTool = ['thinking', 'answer', 'result', 'error', 'warning', 'note', 'example', 'details', 'summary', 'code', 'pre', 'blockquote', 'div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'tr', 'td', 'th'];
    return !nonTool.includes(name);
  });
  const hasCompletion = /<attempt_completion\b/i.test(responseText) || /<attempt_completion>/i.test(responseText) || /attempt_completion/i.test(responseText);
  if (toolLikeBlocks.length === 0 && !hasCompletion && !allBlocks.length) return null;
  return {
    hasXmlToolCall: toolLikeBlocks.length > 0,
    xmlRootName: toolLikeBlocks.length > 0 ? toolLikeBlocks[0].match(/^<(\w[\w-]*)/)?.[1] || null : null,
    xmlBlockCount: toolLikeBlocks.length,
    totalXmlBlockCount: allBlocks.length,
    hasCompletion,
  };
}
