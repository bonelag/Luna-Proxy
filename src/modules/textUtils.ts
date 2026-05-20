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

/**
 * Estimate total tokens across an array of messages.
 * Includes role overhead, content, and tool_calls if present.
 */
export function estimateMessagesTokens(messages: any[]): number {
  if (!Array.isArray(messages) || messages.length === 0) return 0;
  let total = 0;
  for (const msg of messages) {
    if (!msg) continue;
    // Role overhead (~4 tokens per message for framing)
    total += 4;
    const content = typeof msg.content === 'string'
      ? msg.content
      : JSON.stringify(msg.content || '');
    total += estimateTokens(content);
    // Tool calls in assistant messages
    if (Array.isArray(msg.tool_calls)) {
      for (const tc of msg.tool_calls) {
        total += estimateTokens(tc?.function?.name || tc?.name || '');
        const args = typeof tc?.function?.arguments === 'string'
          ? tc.function.arguments
          : JSON.stringify(tc?.function?.arguments || tc?.input || '');
        total += estimateTokens(args);
      }
    }
    // Tool call ID overhead
    if (msg.tool_call_id) total += estimateTokens(msg.tool_call_id);
    if (msg.name) total += estimateTokens(msg.name);
  }
  return total;
}

export interface InputValidationResult {
  /** Whether the input is within limits */
  ok: boolean;
  /** Whether the input exceeds the warning threshold */
  warn: boolean;
  /** Estimated total input tokens */
  totalTokens: number;
  /** The max input token limit */
  maxInputTokens: number;
  /** The warning threshold */
  warnInputTokens: number;
  /** Human-readable suggestion if not ok */
  suggestion?: string;
}

/**
 * Validate input size against configured token limits.
 *
 * Returns a structured result indicating whether the input is acceptable,
 * triggers a warning, or should be rejected.
 */
export function validateInputSize(
  messages: any[],
  maxInputTokens: number,
  warnInputTokens: number,
): InputValidationResult {
  const totalTokens = estimateMessagesTokens(messages);
  const ok = totalTokens <= maxInputTokens;
  const warn = totalTokens > warnInputTokens && totalTokens <= maxInputTokens;

  let suggestion: string | undefined;
  if (!ok) {
    const excess = totalTokens - maxInputTokens;
    suggestion = `Input exceeds maximum token limit by ~${excess} tokens (${totalTokens}/${maxInputTokens}). Reduce conversation history or message size.`;
  } else if (warn) {
    suggestion = `Input is approaching the token limit (${totalTokens}/${maxInputTokens}). Consider reducing message size to avoid upstream errors.`;
  }

  return { ok, warn, totalTokens, maxInputTokens, warnInputTokens, suggestion };
}
