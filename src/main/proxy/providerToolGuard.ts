const TOOL_NOT_EXISTS_PATTERNS = [
  /Tool\s+\w+\s+does\s+not\s+(?:exist|exists)/i,
  /tool\s+['\u2018\u2019"]?\w+['\u2019"]?\s+(?:is\s+)?(?:not\s+)?(?:found|unavailable|unknown|not\s+supported)/i,
  /Function\s+\w+\s+(?:is\s+)?(?:not\s+)?(?:found|unavailable|unknown)/i,
  /No\s+(?:tool|function)\s+(?:named|called)\s+['\u2018\u2019"]?\w+/i,
  /I\s+(?:do not|don't|cannot?)\s+(?:have|possess|use)\s+(?:a\s+)?(?:tool|function)/i,
];

const PROVIDER_TOOL_LEAK_ROLES = ['function', 'tool_call'];

const TOOL_USE_XML_PATTERN = /<tool_use>[\s\S]*?<\/tool_use>/gi;
const FUNCTION_CALL_JSON_PATTERN = /"function":\s*\{[^}]*"name":\s*"[^"]+"/gi;

export interface ProviderToolLeakResult {
  detected: boolean;
  reason?: string;
  leakType?: 'function_role' | 'tool_call_role' | 'tool_not_exists_message' | 'tool_use_xml' | 'function_call_json';
  toolName?: string;
}

export function checkProviderToolLeak(content: string, role?: string): ProviderToolLeakResult {
  if (role && PROVIDER_TOOL_LEAK_ROLES.includes(role)) {
    const toolName = role === 'function' ? extractToolNameFromRole(content) : undefined;
    return {
      detected: true,
      reason: `Provider returned role=${role}`,
      leakType: role === 'function' ? 'function_role' : 'tool_call_role',
      toolName,
    };
  }
  if (!content) return { detected: false };
  for (const pattern of TOOL_NOT_EXISTS_PATTERNS) {
    const match = content.match(pattern);
    if (match) {
      const toolName = match[0].match(/['\u2018\u2019"]?(\w+)['\u2019"]?/)?.[1];
      return {
        detected: true,
        reason: `Provider tool error: ${match[0].slice(0, 120)}`,
        leakType: 'tool_not_exists_message',
        toolName,
      };
    }
  }
  const toolUseMatch = content.match(TOOL_USE_XML_PATTERN);
  if (toolUseMatch) {
    return {
      detected: true,
      reason: 'Provider emitted <tool_use> XML format',
      leakType: 'tool_use_xml',
    };
  }
  const funcCallMatch = content.match(FUNCTION_CALL_JSON_PATTERN);
  if (funcCallMatch) {
    return {
      detected: true,
      reason: 'Provider emitted function_call JSON format',
      leakType: 'function_call_json',
    };
  }
  return { detected: false };
}

function extractToolNameFromRole(content: string): string | undefined {
  const nameMatch = content.match(/^(\w+)\b/) || content.match(/"name"\s*:\s*"(\w+)"/);
  return nameMatch?.[1] || undefined;
}

export function isToolNotFoundMessage(content: string): boolean {
  return TOOL_NOT_EXISTS_PATTERNS.some(p => p.test(content));
}
