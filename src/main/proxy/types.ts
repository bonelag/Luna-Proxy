/**
 * Minimal proxy types for qwen-provider package
 */

export interface ChatMessage {
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string | any[];
    timestamp?: number;
}

export interface ChatCompletionTool {
    function: {
        name: string;
        description?: string;
        parameters?: any;
    };
}

export interface ToolCall {
    index?: number;
    id: string;
    type: 'function';
    function: {name: string; arguments: string};
    rawText?: string;
}
