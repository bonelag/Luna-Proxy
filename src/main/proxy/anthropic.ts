import { InternalMessage, InternalChatRequest, Tool, ToolChoice, ToolCall } from './toolcall/types';
import { parseToolCalls, cleanVisibleText, formatAnthropicToolContentBlock, getToolNames } from './toolcall/toolcall';

interface AnthropicContentBlock {
  type: string;
  text?: string;
  source?: { type: string; media_type?: string; data?: string; url?: string };
  id?: string;
  name?: string;
  input?: Record<string, any>;
  tool_use_id?: string;
  content?: string;
  is_error?: boolean;
}

interface AnthropicRequest {
  model: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string | AnthropicContentBlock[];
  }>;
  system?: string | AnthropicContentBlock[];
  max_tokens: number;
  stream?: boolean;
  tools?: Array<{
    name: string;
    description?: string;
    input_schema?: Record<string, any>;
    type?: string;
    function?: {
      name: string;
      description?: string;
      parameters?: Record<string, any>;
    };
  }>;
  tool_choice?: { type: string; name?: string } | string;
  thinking?: { type: string; budget_tokens?: number };
  metadata?: Record<string, any>;
  response_format?: { type: string; json_schema?: Record<string, any> };
  parallel_tool_calls?: boolean;
}

interface AnthropicResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: AnthropicContentBlock[];
  stop_reason: 'end_turn' | 'max_tokens' | 'stop_sequence' | 'tool_use' | null;
  stop_sequence: string | null;
  usage: { input_tokens: number; output_tokens: number };
}

export function normalizeAnthropicMessage(msg: AnthropicRequest['messages'][0]): InternalMessage[] {
  const role = msg.role;

  if (typeof msg.content === 'string') {
    return [{ role, content: msg.content }];
  }

  if (!Array.isArray(msg.content)) {
    return [{ role, content: '' }];
  }

  const result: InternalMessage[] = [];
  let textParts: string[] = [];

  for (const block of msg.content) {
    if (!block || typeof block !== 'object') continue;

    switch (block.type) {
      case 'text':
        textParts.push(block.text || '');
        break;

      case 'image': {
        if (block.source?.type === 'base64') {
          const mediaType = block.source.media_type || 'image/png';
          const data = block.source.data || '';
          const url = `data:${mediaType};base64,${data}`;
          if (textParts.length > 0) {
            result.push({ role, content: textParts.join('\n') });
            textParts = [];
          }
          result.push({ role, content: url });
        } else if (block.source?.url) {
          if (textParts.length > 0) {
            result.push({ role, content: textParts.join('\n') });
            textParts = [];
          }
          result.push({ role, content: block.source.url });
        }
        break;
      }

      case 'image_url': {
        if (textParts.length > 0) {
          result.push({ role, content: textParts.join('\n') });
          textParts = [];
        }
        result.push({ role, content: block.source?.url || '' });
        break;
      }

      case 'tool_result': {
        if (textParts.length > 0) {
          result.push({ role, content: textParts.join('\n') });
          textParts = [];
        }
        let content = block.content || '';
        if (block.is_error) {
          content = `ERROR: ${content}`;
        }
        result.push({
          role: 'tool',
          content,
          toolCallId: block.tool_use_id,
        });
        break;
      }

      case 'tool_use':
        break;

      default:
        if ((block as any).text) {
          textParts.push((block as any).text);
        }
        break;
    }
  }

  if (textParts.length > 0) {
    result.push({ role, content: textParts.join('\n') });
  }

  return result;
}

export function normalizeAnthropicSystem(
  system: string | AnthropicContentBlock[] | undefined,
): string {
  if (!system) return '';

  if (typeof system === 'string') {
    return system.trim();
  }

  if (Array.isArray(system)) {
    return system
      .filter(b => b && b.type === 'text' && b.text)
      .map(b => b.text!)
      .join('\n')
      .trim();
  }

  return '';
}

export function convertAnthropicTools(
  tools: AnthropicRequest['tools'] | undefined,
): Tool[] {
  if (!tools || !Array.isArray(tools)) return [];

  return tools.map(t => {
    if (t.type === 'function' && t.function) {
      return {
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
      };
    }

    return {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    };
  });
}

export function convertAnthropicToolChoice(
  toolChoice: AnthropicRequest['tool_choice'] | undefined,
): ToolChoice | undefined {
  if (!toolChoice) return undefined;

  if (typeof toolChoice === 'string') {
    if (toolChoice === 'auto') return { mode: 'auto' };
    return { mode: toolChoice as any };
  }

  if (typeof toolChoice === 'object') {
    switch (toolChoice.type) {
      case 'auto':
        return { mode: 'auto' };
      case 'any':
      case 'required':
        return { mode: 'required' };
      case 'tool':
        return { mode: 'specific', name: toolChoice.name };
      case 'function':
        return { mode: 'specific', name: toolChoice.name };
      case 'none':
        return { mode: 'none' };
      default:
        return { mode: 'auto' };
    }
  }

  return undefined;
}

export function convertToInternalRequest(
  anthropicReq: AnthropicRequest,
): InternalChatRequest {
  const systemContent = normalizeAnthropicSystem(anthropicReq.system);
  const internalMessages: InternalMessage[] = [];

  if (systemContent) {
    let finalSystem = systemContent;

    if (anthropicReq.response_format) {
      if (anthropicReq.response_format.type === 'json_object') {
        finalSystem += '\n\nRespond with a valid JSON object only.';
      } else if (anthropicReq.response_format.type === 'json_schema' && anthropicReq.response_format.json_schema) {
        finalSystem += `\n\nRespond with JSON that conforms to this schema: ${JSON.stringify(anthropicReq.response_format.json_schema)}`;
      }
    }

    internalMessages.push({ role: 'system', content: finalSystem });
  }

  for (const msg of anthropicReq.messages || []) {
    const normalized = normalizeAnthropicMessage(msg);
    for (const nmsg of normalized) {
      const existingToolMsg = internalMessages.find(
        (m, i) => i > 0 && m.role === 'tool' && m.toolCallId === nmsg.toolCallId,
      );
      if (!existingToolMsg) {
        internalMessages.push(nmsg);
      }
    }
  }

  const tools = convertAnthropicTools(anthropicReq.tools);
  const toolChoice = convertAnthropicToolChoice(anthropicReq.tool_choice);

  return {
    model: anthropicReq.model,
    messages: internalMessages,
    tools: tools.length > 0 ? tools : undefined,
    toolChoice,
    stream: anthropicReq.stream || false,
    maxTokens: anthropicReq.max_tokens,
    thinking: anthropicReq.thinking ? {
      type: anthropicReq.thinking.type,
      budgetTokens: anthropicReq.thinking.budget_tokens,
    } : undefined,
    metadata: {
      ...anthropicReq.metadata,
      parallel_tool_calls: anthropicReq.parallel_tool_calls,
    },
  };
}

export function renderAnthropicNonStream(
  content: string,
  toolCalls: ToolCall[],
  inputTokens: number,
  outputTokens: number,
  model: string,
  messageId?: string,
): AnthropicResponse {
  const contentBlocks: AnthropicContentBlock[] = [];

  if (content) {
    contentBlocks.push({ type: 'text', text: content });
  }

  for (let i = 0; i < toolCalls.length; i++) {
    const tc = toolCalls[i];
    contentBlocks.push({
      type: 'tool_use',
      id: tc.id || `toolu_${(messageId || 'msg').replace(/^msg_/, '')}_${i}`,
      name: tc.name,
      input: tc.input,
    });
  }

  return {
    id: messageId || `msg_${Date.now().toString(36)}`,
    type: 'message',
    role: 'assistant',
    content: contentBlocks,
    stop_reason: toolCalls.length > 0 ? 'tool_use' : 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: inputTokens || 1,
      output_tokens: outputTokens || 1,
    },
  };
}

export function renderAnthropicStreamEvent(
  eventType: string,
  data: Record<string, any>,
): string {
  return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function createAnthropicStream(
  model: string,
  messageId: string,
): NodeJS.ReadableStream {
  const { PassThrough } = require('stream');
  const stream = new PassThrough();

  const msgId = messageId || `msg_${Date.now().toString(36)}`;

  stream.write(renderAnthropicStreamEvent('message_start', {
    type: 'message_start',
    message: {
      id: msgId,
      type: 'message',
      role: 'assistant',
      content: [],
      model,
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 1, output_tokens: 1 },
    },
  }));

  stream.write(renderAnthropicStreamEvent('ping', { type: 'ping' }));

  return stream;
}

export function writeAnthropicStreamText(stream: any, contentIndex: number, text: string): void {
  stream.write(renderAnthropicStreamEvent('content_block_start', {
    type: 'content_block_start',
    index: contentIndex,
    content_block: { type: 'text', text: '' },
  }));

  stream.write(renderAnthropicStreamEvent('content_block_delta', {
    type: 'content_block_delta',
    index: contentIndex,
    delta: { type: 'text_delta', text },
  }));

  stream.write(renderAnthropicStreamEvent('content_block_stop', {
    type: 'content_block_stop',
    index: contentIndex,
  }));
}

export function writeAnthropicStreamToolCall(stream: any, contentIndex: number, toolCall: ToolCall, messageId: string): void {
  const toolUseId = toolCall.id || `toolu_${messageId.replace(/^msg_/, '')}_${contentIndex}`;

  stream.write(renderAnthropicStreamEvent('content_block_start', {
    type: 'content_block_start',
    index: contentIndex,
    content_block: {
      type: 'tool_use',
      id: toolUseId,
      name: toolCall.name,
      input: {},
    },
  }));

  stream.write(renderAnthropicStreamEvent('content_block_delta', {
    type: 'content_block_delta',
    index: contentIndex,
    delta: {
      type: 'input_json_delta',
      partial_json: JSON.stringify(toolCall.input),
    },
  }));

  stream.write(renderAnthropicStreamEvent('content_block_stop', {
    type: 'content_block_stop',
    index: contentIndex,
  }));
}

export function endAnthropicStream(stream: any, toolCallsCount: number, inputTokens?: number, outputTokens?: number): void {
  stream.write(renderAnthropicStreamEvent('message_delta', {
    type: 'message_delta',
    delta: {
      stop_reason: toolCallsCount > 0 ? 'tool_use' : 'end_turn',
      stop_sequence: null,
    },
    usage: {
      output_tokens: outputTokens || 1,
    },
  }));

  stream.write(renderAnthropicStreamEvent('message_stop', {
    type: 'message_stop',
  }));

  stream.end();
}

export function parseAnthropicToolUse(toolCall: any): ToolCall | null {
  if (!toolCall || toolCall.type !== 'tool_use') return null;

  return {
    id: toolCall.id || `call_${Date.now().toString(36)}`,
    name: toolCall.name,
    input: toolCall.input || {},
  };
}

export function estimateAnthropicInputTokens(request: AnthropicRequest): number {
  let count = 0;

  const systemStr = typeof request.system === 'string' ? request.system : JSON.stringify(request.system);
  count += Math.ceil((systemStr?.length || 0) / 4);

  for (const msg of request.messages || []) {
    if (typeof msg.content === 'string') {
      count += Math.ceil(msg.content.length / 4);
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.text) count += Math.ceil(block.text.length / 4);
        count += 1;
      }
    }
    count += 1;
  }

  for (const tool of request.tools || []) {
    count += Math.ceil((tool.name?.length || 0) / 2);
    count += Math.ceil((tool.description?.length || 0) / 4);
    count += 2;
  }

  return Math.max(1, count);
}
