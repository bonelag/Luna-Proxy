import path from 'path';
import { describe, it, assertEqual, assertTrue, assertFalse, assertMatch, assertNotMatch, printSummary, totalPassed, totalFailed, flushAsync } from './utils';

process.env.NODE_ENV = 'test';
process.chdir(path.join(__dirname, '..'));

const {
  injectToolPrompt,
  normalizeToolMessages,
  toolCallsToMlxXml,
  parseToolCalls,
  cleanVisibleText,
  cleanVisibleChunk,
  createStreamState,
  processStreamChunk,
  finalizeStream,
  formatOpenAiToolCalls,
  renderToolDetails,
} = require('../src/main/proxy/toolcall/toolcall');

const {
  convertAnthropicTools,
  convertAnthropicToolChoice,
  normalizeAnthropicMessage,
  normalizeAnthropicSystem,
  renderAnthropicNonStream,
  estimateAnthropicInputTokens,
} = require('../src/main/proxy/anthropic');

const { QwenAiStreamHandler } = require('../src/main/proxy/adapters/qwen-ai');
const { PassThrough } = require('stream');

describe('toolcall - injectToolPrompt', () => {
  it('injects tool prompt when tools present', () => {
    const messages: any[] = [
      { role: 'user', content: 'search for golang' },
    ];
    const tools: any[] = [
      { name: 'search', description: 'Search the web', parameters: { type: 'object', properties: { query: { type: 'string' } } } },
    ];

    const { messages: result, toolNames } = injectToolPrompt(messages, tools);

    assertEqual(toolNames, ['search']);
    assertTrue(result.length >= 2, 'should have system + user messages');
    assertEqual(result[0].role, 'system');
    assertTrue(result[0].content.includes('You have access to these tools'), 'should include tool prompt');
    assertTrue(result[0].content.includes('search'), 'should include tool name');
    assertTrue(result[0].content.includes('<ml_tool_calls>'), 'should include ml_xml format');
  });

  it('returns unmodified when no tools', () => {
    const messages: any[] = [
      { role: 'user', content: 'hello' },
    ];

    const { messages: result, toolNames } = injectToolPrompt(messages, []);
    assertEqual(toolNames, []);
    assertEqual(result.length, 1);
    assertEqual(result[0].content, 'hello');
  });

  it('prevents injection when tool_choice is none', () => {
    const messages: any[] = [
      { role: 'user', content: 'hello' },
    ];
    const tools: any[] = [
      { name: 'search', description: 'Search', parameters: {} },
    ];

    const { messages: result, toolNames } = injectToolPrompt(messages, tools, { mode: 'none' });
    assertEqual(toolNames, ['search']);
    assertEqual(result.length, 1);
    assertFalse(result[0].content.includes('You have access to these tools'), 'should NOT inject tool prompt');
  });

  it('merges multiple system messages into one', () => {
    const messages: any[] = [
      { role: 'system', content: 'You are helpful' },
      { role: 'user', content: 'hello' },
      { role: 'system', content: 'Second system' },
    ];
    const tools: any[] = [
      { name: 'search', description: 'Search', parameters: {} },
    ];

    const { messages: result } = injectToolPrompt(messages, tools);
    const sysMessages = result.filter((m: any) => m.role === 'system');
    assertEqual(sysMessages.length, 1, 'system messages merged');
    assertTrue(sysMessages[0].content.includes('You are helpful'), 'first system content preserved');
    assertTrue(sysMessages[0].content.includes('Second system'), 'second system content preserved');
    assertTrue(sysMessages[0].content.includes('You have access'), 'tool prompt appended');
  });

  it('adds reminder to latest non-system message', () => {
    const messages: any[] = [
      { role: 'user', content: 'do something' },
    ];
    const tools: any[] = [
      { name: 'search', description: 'Search', parameters: {} },
    ];

    const { messages: result } = injectToolPrompt(messages, tools);
    const lastUser = result.filter((m: any) => m.role !== 'system').pop();
    assertTrue(lastUser.content.includes('[ml_tool reminder]'), 'reminder added');
    assertTrue(lastUser.content.includes('search'), 'tool names in reminder');
  });
});

describe('toolcall - normalizeToolMessages', () => {
  it('converts assistant tool_calls to ML_XML', () => {
    const messages: any[] = [
      { role: 'user', content: 'search for golang' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'call_1', name: 'search', input: { query: 'golang' } },
        ],
      },
    ];

    const result = normalizeToolMessages(messages);
    const assistant = result[1];
    assertTrue(assistant.content.includes('<ml_tool_calls>'), 'should wrap in ml_xml');
    assertTrue(assistant.content.includes('search'), 'should contain tool name');
    assertTrue(assistant.content.includes('golang'), 'should contain parameter value');
  });

  it('converts tool results to user messages with ML_XML result wrapper', () => {
    const messages: any[] = [
      { role: 'assistant', content: 'using tool' },
      { role: 'tool', content: 'found 42 results', toolCallId: 'call_1', toolName: 'search' },
    ];

    const result = normalizeToolMessages(messages);
    const toolMsg = result[1];
    assertEqual(toolMsg.role, 'user');
    assertTrue(toolMsg.content.includes('<ml_tool_result>'), 'should wrap in ml_tool_result');
    assertTrue(toolMsg.content.includes('found 42 results'), 'content preserved');
  });

  it('handles assistant with both content and tool_calls', () => {
    const messages: any[] = [
      { role: 'user', content: 'search' },
      {
        role: 'assistant',
        content: 'I will search',
        toolCalls: [
          { id: 'call_1', name: 'search', input: { query: 'test' } },
        ],
      },
    ];

    const result = normalizeToolMessages(messages);
    const assistant = result[1];
    assertTrue(assistant.content.includes('I will search'), 'content preserved');
    assertTrue(assistant.content.includes('<ml_tool_calls>'), 'tool calls appended');
  });
});

describe('toolcall - parseToolCalls', () => {
  it('parses ML_XML format with CDATA', () => {
    const xml = `<ml_tool_calls>
  <ml_tool_call>
    <ml_tool_name>search</ml_tool_name>
    <ml_parameters>
      <query><![CDATA[golang]]></query>
    </ml_parameters>
  </ml_tool_call>
</ml_tool_calls>`;

    const calls = parseToolCalls(xml);
    assertEqual(calls.length, 1);
    assertEqual(calls[0].name, 'search');
    assertEqual(calls[0].input.query, 'golang');
  });

  it('parses ML_XML format without CDATA', () => {
    const xml = `<ml_tool_calls>
  <ml_tool_call>
    <ml_tool_name>read_file</ml_tool_name>
    <ml_parameters>
      <path>/tmp/test.txt</path>
    </ml_parameters>
  </ml_tool_call>
</ml_tool_calls>`;

    const calls = parseToolCalls(xml);
    assertEqual(calls.length, 1);
    assertEqual(calls[0].name, 'read_file');
    assertEqual(calls[0].input.path, '/tmp/test.txt');
  });

  it('parses multiple tool calls', () => {
    const xml = `<ml_tool_calls>
  <ml_tool_call>
    <ml_tool_name>search</ml_tool_name>
    <ml_parameters>
      <query><![CDATA[golang]]></query>
    </ml_parameters>
  </ml_tool_call>
  <ml_tool_call>
    <ml_tool_name>read_file</ml_tool_name>
    <ml_parameters>
      <path><![CDATA[/tmp/test.txt]]></path>
    </ml_parameters>
  </ml_tool_call>
</ml_tool_calls>`;

    const calls = parseToolCalls(xml);
    assertEqual(calls.length, 2);
    assertEqual(calls[0].name, 'search');
    assertEqual(calls[1].name, 'read_file');
  });

  it('parses legacy XML format gracefully', () => {
    const legacy = `<tool_use><name>search</name><arguments>{"query":"golang"}</arguments></tool_use>`;
    const calls = parseToolCalls(legacy);
    assertEqual(calls.length, 1);
    assertEqual(calls[0].name, 'search');
    assertEqual(calls[0].input.query, 'golang');
  });

  it('parses legacy tool_calls tags gracefully', () => {
    const legacy = `<tool_calls>
  <tool_call>
    <tool_name>search</tool_name>
    <parameters>
      <query><![CDATA[golang]]></query>
    </parameters>
  </tool_call>
</tool_calls>`;
    const calls = parseToolCalls(legacy);
    assertEqual(calls.length, 1);
    assertEqual(calls[0].name, 'search');
    assertEqual(calls[0].input.query, 'golang');
  });

  it('returns empty array for plain text', () => {
    const calls = parseToolCalls('Hello world');
    assertEqual(calls.length, 0);
  });

  it('returns empty array for empty input', () => {
    const calls = parseToolCalls('');
    assertEqual(calls.length, 0);
  });

  it('parses JSON parameter values', () => {
    const xml = `<ml_tool_calls>
  <ml_tool_call>
    <ml_tool_name>search</ml_tool_name>
    <ml_parameters>
      <limit>10</limit>
      <enabled>true</enabled>
      <filters>{"type":"article"}</filters>
    </ml_parameters>
  </ml_tool_call>
</ml_tool_calls>`;

    const calls = parseToolCalls(xml);
    assertEqual(calls[0].input.limit, 10);
    assertEqual(calls[0].input.enabled, true);
    assertEqual(calls[0].input.filters.type, 'article');
  });
});

describe('toolcall - cleanVisibleText', () => {
  it('removes ML_XML tool calls from text', () => {
    const text = `Here is the result.

<ml_tool_calls>
  <ml_tool_call>
    <ml_tool_name>search</ml_tool_name>
    <ml_parameters>
      <query><![CDATA[golang]]></query>
    </ml_parameters>
  </ml_tool_call>
</ml_tool_calls>`;

    const cleaned = cleanVisibleText(text);
    assertFalse(cleaned.includes('<ml_tool_calls>'), 'ml_tool_calls removed');
    assertFalse(cleaned.includes('<ml_tool_call>'), 'ml_tool_call removed');
    assertFalse(cleaned.includes('golang'), 'tool content removed');
    assertTrue(cleaned.includes('Here is the result'), 'text content preserved');
  });

  it('removes legacy tool_use tags', () => {
    const text = `Hello<tool_use><name>test</name><arguments>{}</arguments></tool_use>`;
    const cleaned = cleanVisibleText(text);
    assertFalse(cleaned.includes('<tool_use>'));
    assertTrue(cleaned.includes('Hello'));
  });

  it('removes legacy tool_calls tags', () => {
    const text = `Before <tool_calls><tool_call><tool_name>search</tool_name><parameters><query>x</query></parameters></tool_call></tool_calls> After`;
    const cleaned = cleanVisibleText(text);
    assertFalse(cleaned.includes('<tool_calls>'));
    assertEqual(cleaned, 'Before  After');
  });

  it('removes bracket format', () => {
    const text = `Text[function_calls][call:test]{}[/call][/function_calls]`;
    const cleaned = cleanVisibleText(text);
    assertFalse(cleaned.includes('[function_calls]'));
    assertTrue(cleaned.includes('Text'));
  });

  it('removes tool leak patterns', () => {
    const text = 'The tool resources exhausted. Continue answering.';
    const cleaned = cleanVisibleText(text);
    assertFalse(cleaned.includes('tool resources exhausted'));
    assertTrue(cleaned.includes('Continue answering'));
  });

  it('removes residual tags', () => {
    const text = 'content</ml_tool_calls>';
    const cleaned = cleanVisibleText(text);
    assertFalse(cleaned.includes('</ml_tool_calls>'));
  });

  it('handles empty input', () => {
    assertEqual(cleanVisibleText(''), '');
  });
});

describe('toolcall - cleanVisibleChunk', () => {
  it('removes partial XML tags from stream chunks', () => {
    const chunks = [
      '</ml_tool_calls>',
      '<ml_tool_name>',
      '<![CDATA[test]]>',
    ];

    for (const chunk of chunks) {
      const cleaned = cleanVisibleChunk(chunk);
      assertEqual(cleaned, '', `should clean chunk: ${chunk}`);
    }
  });

  it('preserves normal text', () => {
    assertEqual(cleanVisibleChunk('Hello world'), 'Hello world');
  });
});

describe('toolcall - stream processing', () => {
  it('detects tool call marker split across chunks', () => {
    const state = createStreamState();

    const r1 = processStreamChunk('Hello ', state);
    assertEqual(r1.text, 'Hello ');

    const r2 = processStreamChunk('<ml_', state);
    assertEqual(r2.text, '', 'starts buffering on partial marker');

    const r3 = processStreamChunk('tool_calls>', state);
    assertTrue(state.capturing, 'should be capturing after full marker');

    const r4 = processStreamChunk('<ml_tool_call><ml_tool_name>search</ml_tool_name><ml_parameters><query><![CDATA[golang]]></query></ml_parameters></ml_tool_call>', state);
    assertFalse(r4.text, 'should not emit text while capturing');

    const r5 = processStreamChunk('</ml_tool_calls>', state);
    assertTrue(r5.finishToolCall, 'should finish tool call parsing');
    assertEqual(r5.toolCallDeltas.length, 1);
    assertEqual(r5.toolCallDeltas[0].name, 'search');
    assertEqual(r5.toolCallDeltas[0].input.query, 'golang');
  });

  it('handles close tag split across chunks', () => {
    const state = createStreamState();
    state.pending = '<ml_tool_calls><ml_tool_call><ml_tool_name>search</ml_tool_name><ml_parameters><query><![CDATA[test]]></query></ml_parameters></ml_tool_call>';
    state.capturing = true;
    state.captureBuffer = state.pending;
    state.pending = '';

    const r1 = processStreamChunk('</', state);
    assertFalse(r1.finishToolCall);

    const r2 = processStreamChunk('ml_tool_calls>', state);
    assertTrue(r2.finishToolCall, 'should detect close tag split');
    assertEqual(r2.toolCallDeltas.length, 1);
  });

  it('finalizeStream returns remaining tool calls', () => {
    const state = createStreamState();
    state.capturing = true;
    state.captureBuffer = '<ml_tool_calls><ml_tool_call><ml_tool_name>search</ml_tool_name><ml_parameters><query><![CDATA[final]]></query></ml_parameters></ml_tool_call>';
    state.toolCalls = [{ name: 'search', parameters: { query: 'final' } }];

    const result = finalizeStream(state);
    assertEqual(result.toolCallDeltas.length, 1);
    assertEqual(result.toolCallDeltas[0].name, 'search');
  });

  it('preserves text before tool call marker', () => {
    const state = createStreamState();
    const r = processStreamChunk('Here is the answer.<ml_tool_calls><ml_tool_call><ml_tool_name>search</ml_tool_name><ml_parameters><q><![CDATA[x]]></q></ml_parameters></ml_tool_call></ml_tool_calls>', state);
    assertEqual(r.text, 'Here is the answer.');
    assertTrue(r.finishToolCall);
  });

  it('handles empty chunks', () => {
    const state = createStreamState();
    const r = processStreamChunk('', state);
    assertEqual(r.text, '');
    assertEqual(r.toolCallDeltas.length, 0);
  });
});

describe('toolcall - formatOpenAiToolCalls', () => {
  it('formats tool calls for OpenAI response', () => {
    const calls: any[] = [
      { id: 'call_1', name: 'search', input: { query: 'golang' } },
    ];

    const formatted = formatOpenAiToolCalls(calls);
    assertEqual(formatted.length, 1);
    assertEqual(formatted[0].index, 0);
    assertEqual(formatted[0].id, 'call_1');
    assertEqual(formatted[0].type, 'function');
    assertEqual(formatted[0].function.name, 'search');
    assertTrue(typeof formatted[0].function.arguments === 'string');
    const parsed = JSON.parse(formatted[0].function.arguments);
    assertEqual(parsed.query, 'golang');
  });

  it('respects index offset', () => {
    const calls: any[] = [
      { id: 'call_1', name: 'search', input: {} },
    ];

    const formatted = formatOpenAiToolCalls(calls, 5);
    assertEqual(formatted[0].index, 5);
  });
});

describe('anthropic - convertAnthropicTools', () => {
  it('converts Anthropic tools to internal format', () => {
    const tools: any[] = [
      { name: 'search', description: 'Search docs', input_schema: { type: 'object' } },
    ];

    const result = convertAnthropicTools(tools);
    assertEqual(result.length, 1);
    assertEqual(result[0].name, 'search');
    assertEqual(result[0].description, 'Search docs');
    assertEqual(result[0].parameters?.type, 'object');
  });

  it('converts LiteLLM/OpenAI-style tools in Anthropic endpoint', () => {
    const tools: any[] = [
      {
        type: 'function',
        function: { name: 'search', description: 'Search', parameters: { type: 'object' } },
      },
    ];

    const result = convertAnthropicTools(tools);
    assertEqual(result.length, 1);
    assertEqual(result[0].name, 'search');
  });

  it('returns empty array for undefined tools', () => {
    assertEqual(convertAnthropicTools(undefined).length, 0);
  });
});

describe('anthropic - convertAnthropicToolChoice', () => {
  it('converts auto string', () => {
    const result = convertAnthropicToolChoice('auto');
    assertEqual(result?.mode, 'auto');
  });

  it('converts auto object', () => {
    const result = convertAnthropicToolChoice({ type: 'auto' });
    assertEqual(result?.mode, 'auto');
  });

  it('converts any/required', () => {
    const anyResult = convertAnthropicToolChoice({ type: 'any' });
    assertEqual(anyResult?.mode, 'required');

    const requiredResult = convertAnthropicToolChoice({ type: 'required' });
    assertEqual(requiredResult?.mode, 'required');
  });

  it('converts specific tool', () => {
    const result = convertAnthropicToolChoice({ type: 'tool', name: 'search' });
    assertEqual(result?.mode, 'specific');
    assertEqual(result?.name, 'search');
  });

  it('returns undefined when not set', () => {
    assertEqual(convertAnthropicToolChoice(undefined), undefined);
  });
});

describe('anthropic - normalizeAnthropicSystem', () => {
  it('handles string system', () => {
    assertEqual(normalizeAnthropicSystem('You are helpful'), 'You are helpful');
  });

  it('handles array of text blocks', () => {
    const system: any[] = [
      { type: 'text', text: 'You are' },
      { type: 'text', text: 'helpful' },
    ];
    const result = normalizeAnthropicSystem(system);
    assertTrue(result.includes('You are'));
    assertTrue(result.includes('helpful'));
  });

  it('filters non-text blocks', () => {
    const system: any[] = [
      { type: 'text', text: 'You are helpful' },
      { type: 'image', source: { type: 'base64', data: 'abc' } },
    ];
    const result = normalizeAnthropicSystem(system);
    assertEqual(result, 'You are helpful');
  });

  it('returns empty for undefined', () => {
    assertEqual(normalizeAnthropicSystem(undefined), '');
  });
});

describe('anthropic - normalizeAnthropicMessage', () => {
  it('handles string content', () => {
    const result = normalizeAnthropicMessage({ role: 'user', content: 'hello' });
    assertEqual(result.length, 1);
    assertEqual(result[0].role, 'user');
    assertEqual(result[0].content, 'hello');
  });

  it('handles text blocks', () => {
    const result = normalizeAnthropicMessage({
      role: 'user',
      content: [{ type: 'text', text: 'hello' }],
    });
    assertEqual(result.length, 1);
    assertEqual(result[0].content, 'hello');
  });

  it('handles tool_result blocks', () => {
    const result = normalizeAnthropicMessage({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'call_1',
          content: 'result data',
        },
      ],
    });
    assertEqual(result.length, 1);
    assertEqual(result[0].role, 'tool');
    assertEqual(result[0].content, 'result data');
    assertEqual(result[0].toolCallId, 'call_1');
  });

  it('prefixes ERROR for failed tool results', () => {
    const result = normalizeAnthropicMessage({
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'call_1',
          content: 'failed',
          is_error: true,
        },
      ],
    });
    assertTrue(result[0].content.startsWith('ERROR:'));
  });

  it('combines multiple text blocks', () => {
    const result = normalizeAnthropicMessage({
      role: 'user',
      content: [
        { type: 'text', text: 'first' },
        { type: 'text', text: 'second' },
      ],
    });
    assertEqual(result[0].content, 'first\nsecond');
  });
});

describe('anthropic - renderAnthropicNonStream', () => {
  it('renders text-only response', () => {
    const response = renderAnthropicNonStream('Hello', [], 10, 5, 'test-model');
    assertEqual(response.type, 'message');
    assertEqual(response.role, 'assistant');
    assertEqual(response.content.length, 1);
    assertEqual(response.content[0].type, 'text');
    assertEqual(response.content[0].text, 'Hello');
    assertEqual(response.stop_reason, 'end_turn');
  });

  it('renders tool_use response', () => {
    const calls: any[] = [
      { id: 'toolu_test_0', name: 'search', input: { query: 'golang' } },
    ];

    const response = renderAnthropicNonStream('', calls, 10, 5, 'test-model');
    assertEqual(response.stop_reason, 'tool_use');
    assertEqual(response.content.length, 1);
    assertEqual(response.content[0].type, 'tool_use');
    assertEqual(response.content[0].name, 'search');
    assertEqual(response.content[0].input.query, 'golang');
  });

  it('renders combined text and tool_use', () => {
    const calls: any[] = [
      { id: 'toolu_test_0', name: 'search', input: { query: 'golang' } },
    ];

    const response = renderAnthropicNonStream('Let me search', calls, 10, 5, 'test-model');
    assertEqual(response.content.length, 2);
    assertEqual(response.content[0].type, 'text');
    assertEqual(response.content[1].type, 'tool_use');
  });
});

describe('anthropic - estimateAnthropicInputTokens', () => {
  it('estimates tokens for simple request', () => {
    const request: any = {
      model: 'test',
      messages: [{ role: 'user', content: 'hello' }],
    };
    const tokens = estimateAnthropicInputTokens(request);
    assertTrue(tokens > 0);
  });

  it('estimates tokens with tools', () => {
    const request: any = {
      model: 'test',
      messages: [{ role: 'user', content: 'search something' }],
      tools: [{ name: 'search', description: 'Search', input_schema: {} }],
    };
    const tokens = estimateAnthropicInputTokens(request);
    assertTrue(tokens > 2);
  });
});

describe('toolcall - renderToolDetails', () => {
  it('renders tool details with name, description, parameters', () => {
    const tools: any[] = [
      { name: 'search', description: 'Search the web', parameters: { type: 'object' } },
    ];

    const result = renderToolDetails(tools);
    assertTrue(result.includes('search'));
    assertTrue(result.includes('Search the web'));
    assertTrue(result.includes('type'));
  });

  it('handles missing description', () => {
    const tools: any[] = [
      { name: 'search', parameters: {} },
    ];

    const result = renderToolDetails(tools);
    assertTrue(result.includes('search'));
    assertTrue(result.includes('No description'));
  });
});

describe('toolcall - toolCallsToMlxXml', () => {
  it('converts tool calls to ML_XML format', () => {
    const calls: any[] = [
      { id: 'call_1', name: 'search', input: { query: 'golang' } },
    ];

    const xml = toolCallsToMlxXml(calls);
    assertTrue(xml.includes('<ml_tool_calls>'));
    assertTrue(xml.includes('<ml_tool_name>search</ml_tool_name>'));
    assertTrue(xml.includes('<query>'));
    assertTrue(xml.includes('golang'));
    assertTrue(xml.includes('<![CDATA['));
  });

  it('handles multiple tool calls', () => {
    const calls: any[] = [
      { id: 'call_1', name: 'search', input: { query: 'golang' } },
      { id: 'call_2', name: 'read_file', input: { path: '/tmp/test.txt' } },
    ];

    const xml = toolCallsToMlxXml(calls);
    const parsedBack = parseToolCalls(xml);
    assertEqual(parsedBack.length, 2);
    assertEqual(parsedBack[0].name, 'search');
    assertEqual(parsedBack[1].name, 'read_file');
  });

  it('preserves special chars inside CDATA', () => {
    const calls: any[] = [
      { id: 'call_1', name: 'search', input: { query: 'foo & bar <baz>' } },
    ];

    const xml = toolCallsToMlxXml(calls);
    assertTrue(xml.includes('<![CDATA['), 'should wrap in CDATA');
    assertTrue(xml.includes('foo & bar <baz>'), 'should preserve raw text in CDATA');
  });
});

describe('qwen stream - native function_call interception', () => {
  it('converts Qwen native function_call leak to OpenAI tool_calls', async () => {
    const upstream = new PassThrough();
    const handler = new QwenAiStreamHandler('test-model');
    const transformed = await handler.handleStream(upstream);
    const chunks: Buffer[] = [];
    transformed.on('data', (chunk: Buffer) => chunks.push(chunk));

    upstream.write('data: {"response.created":{"response_id":"resp_test"}}\n\n');
    upstream.write('data: {"choices":[{"delta":{"role":"assistant","phase":"answer","status":"typing","function_call":{"name":"Read","arguments":"{\\"file_path\\":\\"/tmp/a.txt\\"}"}}}]}\n\n');
    upstream.write('data: {"choices":[{"delta":{"role":"function","phase":"answer","status":"typing","name":"Read","content":"Tool Read does not exists."}}]}\n\n');

    await new Promise<void>((resolve, reject) => {
      transformed.once('end', resolve);
      transformed.once('error', reject);
      upstream.end();
    });

    const out = Buffer.concat(chunks).toString('utf8');
    assertTrue(out.includes('"tool_calls"'), 'should emit tool_calls');
    assertTrue(out.includes('"name":"Read"'), 'should preserve function name');
    assertTrue(out.includes('\\"file_path\\":\\"/tmp/a.txt\\"'), 'should preserve arguments');
    assertTrue(out.includes('"finish_reason":"tool_calls"'), 'should finish as tool_calls');
    assertFalse(out.includes('Tool Read does not exists'), 'should suppress provider tool leak');
  });
});

flushAsync().then(() => {
  printSummary();
  if (totalFailed > 0) {
    process.exitCode = 1;
  }
});
