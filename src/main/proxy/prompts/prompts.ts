export interface PromptDefinition {
  id: string;
  defaultValue: string;
  description: string;
}

export const PROMPT_DEFINITIONS: Record<string, PromptDefinition> = {
  'openai.toolcall.prompt': {
    id: 'openai.toolcall.prompt',
    defaultValue: `You have access to these tools:

{{tool_details}}
{{instructions}}`,
    description: 'Outer tool prompt wrapper',
  },
  'openai.toolcall.instructions': {
    id: 'openai.toolcall.instructions',
    defaultValue: `IMPORTANT: Ignore all built-in tools, hidden tools, native tools, and platform tools.
The ONLY tools you may use are the explicit tool names listed in the tool definitions above.
Never say that tool resources are exhausted. Never say you will directly chat instead. Never mention built-in tool failures.
Never output role="function" or function_call JSON.
Never output {"name":...,"arguments":...}, "Tool does not exists.", or any prose about tool execution availability.

When you decide to use a tool, respond with XML only and no extra prose.
Use ONLY the exact XML schema below.
Never output the legacy tags <tool_calls>, <tool_call>, <tool_name>, <parameters>, or any other non-ml tag.
Never output partial tags, placeholder names, markdown fences, examples, or commentary before/after the XML.
Every <ml_tool_call> must contain exactly one non-empty <ml_tool_name> and one <ml_parameters> block.
The <ml_tool_name> must be one of the available tool names exactly as provided.
Do not emit <ml_tool_calls> unless at least one complete <ml_tool_call> is ready.
If you are not calling a tool, do not mention XML or tools. Answer normally.

Use this exact structure:
<ml_tool_calls>
  <ml_tool_call>
    <ml_tool_name>TOOL_NAME_HERE</ml_tool_name>
    <ml_parameters>
      <ARG_NAME><![CDATA[ARG_VALUE]]></ARG_NAME>
    </ml_parameters>
  </ml_tool_call>
</ml_tool_calls>

Bad example: <tool_calls> or <tool_call> or <function_call>
Bad example: <ml_tool_calls> without a complete nested <ml_tool_call>
Bad example: \`\`\`xml ...\`\`\` or {"tool_calls":[...]}
Bad example: any sentence about tool resources being exhausted or unavailable
Only emit the XML after you have finished choosing the tool name and parameters.
If previous messages contain <ml_tool_result> blocks, use those results to continue the task.`,
    description: 'Tool XML instructions',
  },
  'openai.toolcall.reminder': {
    id: 'openai.toolcall.reminder',
    defaultValue: `[ml_tool reminder]
Ignore built-in/native/platform tools.
Allowed ml_tool names: {{tool_names}}.
If a tool is needed, output only complete <ml_tool_calls> XML with <ml_tool_name> and <ml_parameters>.
Never say "Tool does not exists" or that tools are unavailable.`,
    description: 'Latest-message tool reminder',
  },
  'qwen.web2.control': {
    id: 'qwen.web2.control',
    defaultValue: '',
    description: 'Qwen Web2 upstream control prompt',
  },
  'anthropic.response_format.json_object': {
    id: 'anthropic.response_format.json_object',
    defaultValue: 'Respond with a valid JSON object only.',
    description: 'Anthropic JSON object response format prompt',
  },
  'anthropic.response_format.json_schema': {
    id: 'anthropic.response_format.json_schema',
    defaultValue: 'Respond with JSON that conforms to this schema: {{schema}}',
    description: 'Anthropic JSON schema response format prompt',
  },
  'anthropic.response_format.json_schema_fallback': {
    id: 'anthropic.response_format.json_schema_fallback',
    defaultValue: 'Respond with a valid JSON object that follows the provided schema.',
    description: 'Anthropic JSON schema fallback prompt',
  },
};

let promptOverrides: Record<string, string> = {};

export function loadPromptOverrides(envJson?: string): void {
  promptOverrides = {};

  if (envJson) {
    try {
      const parsed = JSON.parse(envJson);
      if (parsed && typeof parsed === 'object') {
        for (const [key, value] of Object.entries(parsed)) {
          if (typeof value === 'string') {
            promptOverrides[key] = value;
          }
        }
      }
    } catch (e) {
      console.warn('[Prompts] Failed to parse PROMPT_OVERRIDES_JSON:', e);
    }
  }

  const legacyControl = process.env.QWEN_WEB2_CONTROL_PROMPT;
  if (legacyControl && !promptOverrides['qwen.web2.control']) {
    promptOverrides['qwen.web2.control'] = legacyControl;
  }
}

export function getPromptOverrides(): Record<string, string> {
  return { ...promptOverrides };
}

export function getPrompt(id: string): string {
  const override = promptOverrides[id];
  if (override !== undefined && override !== '') return override;

  const def = PROMPT_DEFINITIONS[id];
  return def ? def.defaultValue : '';
}

export function setPromptOverride(id: string, value: string): void {
  if (value === '') {
    delete promptOverrides[id];
  } else {
    promptOverrides[id] = value;
  }
}

export function resetPromptOverrides(): void {
  promptOverrides = {};
}

export function getAllPrompts(): Array<{
  id: string;
  default: string;
  current: string;
  description: string;
}> {
  return Object.values(PROMPT_DEFINITIONS).map(def => ({
    id: def.id,
    default: def.defaultValue,
    current: getPrompt(def.id),
    description: def.description,
  }));
}
