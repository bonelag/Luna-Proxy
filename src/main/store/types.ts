/**
 * Minimal store types shim for standalone qwen-provider package
 * Only includes the types referenced by the adapter utilities.
 */

export type AccountStatus = 'active' | 'inactive' | 'expired' | 'error';

export interface Account {
    id: string;
    providerId: string;
    name: string;
    credentials: Record<string, string>;
    status?: AccountStatus;
    createdAt?: number;
    updatedAt?: number;
}

export type ProviderType = 'builtin' | 'custom';

export type AuthType =
    | 'oauth'
    | 'token'
    | 'cookie'
    | 'userToken'
    | 'refresh_token'
    | 'jwt'
    | 'realUserID_token'
    | 'tongyi_sso_ticket';

export interface Provider {
    id: string;
    name?: string;
    type?: ProviderType;
    authType?: AuthType;
    apiEndpoint: string;
    chatPath?: string;
    headers?: Record<string, string>;
    description?: string;
    enabled?: boolean;
}

export interface BuiltinProviderConfig extends Provider {
    credentialFields?: any[];
    tokenCheckEndpoint?: string;
    tokenCheckMethod?: 'GET' | 'POST';
    supportedModels?: string[];
    modelMappings?: Record<string, string>;
    modelsApiEndpoint?: string;
    modelsApiHeaders?: Record<string, string>;
}

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

export type ToolCallFormat = 'bracket' | 'xml' | 'anthropic' | 'json' | 'unknown';
