export type ClientToolProtocol =
  | 'call_xml'
  | 'tool_use_xml'
  | 'bare_xml'
  | 'bracket_call'
  | 'client_provided'
  | 'none';

export interface ClientProtocolProfile {
  client: string;
  protocol: ClientToolProtocol;
  contractName: string;
  allowToolTags: boolean;
  guardText: string;
  passthroughText: string;
}

function messageText(message: any): string {
  if (!message?.content) return '';
  return typeof message.content === 'string' ? message.content : JSON.stringify(message.content || '');
}

export function collectMessagesText(messages: any[]): string {
  return messages.map(messageText).filter(Boolean).join('\n\n');
}

export function detectClientName(messages: any[]): string {
  const text = collectMessagesText(messages);
  if (/LunaCoding/i.test(text) || /AI harness assistant named ["']?Luna/i.test(text)) return 'lunaCoding';
  if (/You are Cline/i.test(text)) return 'cline';
  if (/\bRoo\b/i.test(text) || /ask_followup_question/i.test(text)) return 'roo';
  if (/Claude Code/i.test(text) || /interactive CLI tool/i.test(text)) return 'claudeCode';
  if (/Cherry Studio/i.test(text)) return 'cherryStudio';
  if (/You are Kilo/i.test(text)) return 'kilocode';
  if (/Codex CLI/i.test(text) || /apply_patch/i.test(text)) return 'codexCli';
  if (/GitHub Copilot/i.test(text) || /VS Code Agent/i.test(text)) return 'vscodeAgent';
  return 'unknown';
}

export function detectToolProtocol(messages: any[]): ClientToolProtocol {
  const text = collectMessagesText(messages);
  if (/<call\s+name=["'][^"']+["'][^>]*>/i.test(text)) return 'call_xml';
  if (/<tool_use>[\s\S]*?<name>[\s\S]*?<arguments>[\s\S]*?<\/tool_use>/i.test(text)) return 'tool_use_xml';
  if (/\[call:[^\]]+\][\s\S]*?\[\/call\]/i.test(text)) return 'bracket_call';
  if (/<(?:read_file|write_to_file|replace_in_file|execute_command|attempt_completion|ask_followup_question|plan_mode_respond)\b/i.test(text)) return 'bare_xml';
  if (/tool-use instructions|available tools|Tool Use Guidelines|tool invocation format/i.test(text)) return 'client_provided';
  return 'none';
}

function protocolGuidance(protocol: ClientToolProtocol): string {
  switch (protocol) {
    case 'call_xml':
      return `Use the client's <call name="tool_name">...</call> XML format exactly.`;
    case 'tool_use_xml':
      return `Use the client's <tool_use><name>...</name><arguments>...</arguments></tool_use> XML format exactly.`;
    case 'bare_xml':
      return `Use the client's bare XML tool tags exactly, for example <read_file>...</read_file> only if that is the provided client format.`;
    case 'bracket_call':
      return `Use the client's bracket call format exactly, for example [call:tool_name]...[/call] only if that is the provided client format.`;
    case 'client_provided':
      return `Use the tool protocol already provided by the client instructions in the conversation. Do not translate it to another XML shape.`;
    case 'none':
    default:
      return `No client tool protocol was confidently detected. Answer normally unless the attached context contains explicit client tool instructions.`;
  }
}

export function getClientProtocolProfile(messages: any[]): ClientProtocolProfile {
  const client = detectClientName(messages);
  const protocol = detectToolProtocol(messages);
  const allowToolTags = protocol !== 'none';
  const guidance = protocolGuidance(protocol);

  if (client === 'lunaCoding') {
    const contractName = 'lunacoding_call_xml';
    const guardText = `You are responding to LunaCoding through Proxy-Luna.
Preserve LunaCoding's response contract.
Use raw XML tool calls only in this shape when a tool is needed:
<call name="tool_name">
  <param>value</param>
</call>
The message containing a tool call must contain only the raw XML call.
Do not emit Cline-style bare tool tags such as <read_file>...</read_file> or <attempt_completion>.
Do not invent tool results.
When the task is complete, answer normally and preserve LunaCoding's requested final-answer format, including any self-reflection block if the client system prompt requested one.`;

    const passthroughText = `You are behind a reverse proxy.
You cannot execute tools directly.
When LunaCoding needs a tool, output the LunaCoding raw XML tool request as literal text only:
<call name="tool_name">
  <param>value</param>
</call>
Do not use provider-native function calls.
Do not emit JSON tool_calls.
Do not emit Cline-style bare tool tags such as <read_file>...</read_file> or <attempt_completion>.
Do not claim a tool failed unless the provided context contains an actual tool result.
The downstream LunaCoding client will parse and execute <call name="..."> tool syntax.
If the task is complete, preserve LunaCoding's requested final-answer format, including any self-reflection block if the client system prompt requested one.`;

    return {client, protocol: 'call_xml', contractName, allowToolTags: true, guardText, passthroughText};
  }

  const contractName = allowToolTags ? `client_protocol_${protocol}` : 'generic_plain_text';

  const guardText = allowToolTags
    ? `You are responding to the downstream client through Proxy-Luna.
Preserve the downstream client's tool and completion protocol.
${guidance}
Emit at most one tool call when more information is needed.
Do not invent tool results.
Do not write tool-result text yourself.
When the task is complete, use the downstream client's completion/final-answer format.`
    : `Answer normally.
Do not output fake tool calls or client-side XML tool tags.`;

  const passthroughText = `You are behind a reverse proxy.
You cannot execute tools.
When a downstream client tool is needed, output the tool request as literal text only.
Do not use provider-native function calls.
Do not emit JSON tool_calls.
Do not claim a tool failed unless the provided context contains an actual tool result.
The downstream client will parse and execute tool tags or call syntax.
${guidance}
If the task is complete, use the downstream client's completion/final-answer format.`;

  return {client, protocol, contractName, allowToolTags, guardText, passthroughText};
}
