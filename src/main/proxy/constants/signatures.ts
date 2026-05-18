/**
 * Unified Signature Definitions (package-local copy)
 * Minimal copy of signatures used by qwen-provider utilities
 */

export type ClientType =
    | 'cline'
    | 'rooCode'
    | 'claudeCode'
    | 'cherryStudio'
    | 'kilocode'
    | 'codexCli'
    | 'vscodeAgent'
    | 'unknown';

export type ToolCallFormat =
    | 'bracket'
    | 'xml'
    | 'anthropic'
    | 'json'
    | 'native'
    | 'unknown';

export interface ClientSignatureConfig {
    id: ClientType;
    name: string;
    detectPatterns: string[];
    toolCallFormat: ToolCallFormat;
    injectsPrompt: boolean;
    promptSectionMarkers?: {start: string; end: string};
}

export const CLIENT_SIGNATURES: Record<ClientType, ClientSignatureConfig> = {
    cline: {
        id: 'cline',
        name: 'Cline',
        detectPatterns: ['TOOL USE', 'When using tools, follow this format'],
        toolCallFormat: 'xml',
        injectsPrompt: true,
    },
    rooCode: {
        id: 'rooCode',
        name: 'RooCode',
        detectPatterns: ['## Tool Use Guidelines', 'TOOL USE'],
        toolCallFormat: 'xml',
        injectsPrompt: true,
    },
    claudeCode: {
        id: 'claudeCode',
        name: 'Claude Code',
        detectPatterns: ['interactive CLI tool', 'Claude Code'],
        toolCallFormat: 'anthropic',
        injectsPrompt: true,
    },
    cherryStudio: {
        id: 'cherryStudio',
        name: 'Cherry Studio',
        detectPatterns: ['In this environment you have access to a set of tools', '<tool_use>'],
        toolCallFormat: 'xml',
        injectsPrompt: true,
    },
    kilocode: {
        id: 'kilocode',
        name: 'Kilocode',
        detectPatterns: ['You are Kilo', '## Tools'],
        toolCallFormat: 'native',
        injectsPrompt: true,
    },
    codexCli: {
        id: 'codexCli',
        name: 'Codex CLI',
        detectPatterns: ['Codex CLI', 'apply_patch'],
        toolCallFormat: 'native',
        injectsPrompt: true,
    },
    vscodeAgent: {
        id: 'vscodeAgent',
        name: 'VSCode Agent',
        detectPatterns: ['GitHub Copilot', 'VS Code Agent'],
        toolCallFormat: 'native',
        injectsPrompt: true,
    },
    unknown: {
        id: 'unknown',
        name: 'Unknown',
        detectPatterns: [],
        toolCallFormat: 'bracket',
        injectsPrompt: false,
    },
};

export const GENERAL_TOOL_SIGNATURES = [
    '## Available Tools',
    '## Tool Call Protocol',
    '[function_calls]',
    'TOOL_WRAP_HINT',
    'You can invoke the following developer tools',
    'Tool Call Formatting',
    'TOOL USE',
    '## Tool Use',
    '## Tools',
];

export const FORMAT_SIGNATURES: Record<ToolCallFormat, string[]> = {
    bracket: ['[function_calls]', '[call:', '[/function_calls]', '[/call]'],
    xml: ['<tool_use>', '<name>', '<arguments>', '</tool_use>', '<tool_name>'],
    anthropic: ['<antml:function_calls>', 'antml:invoke', '</antml:function_calls>'],
    json: ['"tool_calls"', '"function"', '"arguments"'],
    native: [],
    unknown: [],
};

export function hasGeneralToolPromptSignature(content: string): boolean {
    return GENERAL_TOOL_SIGNATURES.some(sig => content.includes(sig));
}

export function detectToolCallFormat(content: string): ToolCallFormat {
    for (const [format, signatures] of Object.entries(FORMAT_SIGNATURES)) {
        if (signatures.some(sig => content.includes(sig))) {
            return format as ToolCallFormat;
        }
    }
    return 'bracket';
}
