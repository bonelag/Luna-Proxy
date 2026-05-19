export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, any>;
}

export interface Tool {
  name: string;
  description?: string;
  parameters?: Record<string, any>;
}

export interface ToolChoice {
  mode: 'auto' | 'none' | 'required' | 'specific';
  name?: string;
}

export interface InternalMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  toolCallId?: string;
  toolName?: string;
  toolCalls?: ToolCall[];
  timestamp?: number;
}

export interface InternalChatRequest {
  model: string;
  messages: InternalMessage[];
  tools?: Tool[];
  toolChoice?: ToolChoice;
  stream: boolean;
  maxTokens?: number;
  thinking?: {
    type?: string;
    budgetTokens?: number;
  };
  metadata?: Record<string, any>;
  sessionId?: string;
}

export interface InternalChatResponse {
  id: string;
  content: string;
  toolCalls?: ToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'max_tokens' | 'error';
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface MlxToolCall {
  name: string;
  parameters: Record<string, string>;
}

export interface StreamState {
  pending: string;
  capturing: boolean;
  captureBuffer: string;
  toolCalls: MlxToolCall[];
  hasEmittedToolCall: boolean;
  currentToolCall: MlxToolCall | null;
  currentParamName: string | null;
  insideName: boolean;
  insideParams: boolean;
  insideCdata: boolean;
  cdataBuffer: string;
}
