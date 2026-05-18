/**
 * Qwen AI International Adapter
 * Implements chat.qwen.ai API protocol
 * Based on qwen3-reverse project
 */

import axios, {AxiosResponse} from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import {PassThrough} from 'stream';
import {createParser} from 'eventsource-parser';
import {Account, Provider} from '../../store/types';
import {hasToolUse, parseToolUse, ToolCall} from '../promptToolUse';

const QWEN_AI_BASE = 'https://chat.qwen.ai';

const DEFAULT_HEADERS = {
	Accept: 'application/json',
	'Accept-Language': 'zh-CN,zh;q=0.9',
	'Content-Type': 'application/json',
	source: 'web',
	'User-Agent':
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
	'sec-ch-ua':
		'"Not:A-Brand";v="99", "Google Chrome";v="145", "Chromium";v="145"',
	'sec-ch-ua-mobile': '?0',
	'sec-ch-ua-platform': '"macOS"',
	'Sec-Fetch-Dest': 'empty',
	'Sec-Fetch-Mode': 'cors',
	'Sec-Fetch-Site': 'same-origin',
	'bx-v': '2.5.36',
	'bx-umidtoken':
		'T2gAr9z8byN8sNOmfQ3X9j61MNTNmSqDO5L1rs2jMcQCVhOKgZICcBN-UdTuJGig-NM=',
	'bx-ua':
		'231!lWD36kmUe5E+joKDK5gBZ48FEl2ZWfPwIPF92lBLek2KxVW/XJ2EwruCiDOX5Px4EXNhmh6EfS9eDwQGRwijIK64A4nPqeLysJcDjUACje/H3J4ZgGZpicG6K8AkiGGaEKC830+QSiSUsLRlL/EyhXTmLcJc/5iDkMuOpUhNz0e0Q/nTqjVJ3ko00Q/oyE+jauHhUHfb1GxGHkE+++3+qCS4+ItkaA6tiItCo+romzElfLFD6RIj7oHt9vffs98nLwpHnaqKjufnLFMejSlAUGiQvTofIiGhIvftAMcoFV4mrUHsqyQ/ncQihmJHkbxXjvM57FCb6b9dEIRZl7jgj0+QLNLRs0NZ4azdZ6rzbGTSO8KA5I3Aq/3gBr87X16Mj0oJtaPKmFGaP2zghfOVhxQht8YjRd50lJa+Ue4PAuPSdu2O69DKLH8VOhrsB+psaBIRxnRi5POUQ6w8s8qlb9vxvExjHNOAKWXV1by1Nz+6FPWdyTeAgcmonjCcV0dCtPj/KyeVDkeSrDkKZjnDzHEqeCdfmJ65kve+Vy3YS0vagzyHfVEnzN0ULUZtkGfJXFNm6+bIa55wmGBhUeXbHL0EdlQXMu1YXxmcwBgTaq7tlQcfv7AefanbfjGE8R1IFnNyg2/jXLbnLg5Z6l1oKqgnxZQg0DE9BJuw6s0XjGwTdSxybWxp+WFD/RsXt76uwvCBk7z+YmSFLtFj2UlTsoq+vl0DTmsVItDKf9SZ94NcuJ7mxJYI02S/2kQBfbbHG0d4hXevDrEC0cb86EvzN2ud+v6bAunNRGNFz/RH0KLusoBVeo+puCFKeeIJWEo0t1UicX5YxJwMAoV7+g0gK93y4W9sMQtso8/wY5wsBzis9dwfLvIwXpaAM1g0MZp/YIRq8T/Qc+U/8x99tam4er0IWizvrkjqhIzCWBKpJ4Y4gj3bOmiS3VCMEaoVfKCwUWENwYKuP3H5VI0n+O2vVVRrekUrwvkm6URRhVhN4eEFTCjB9nSQu++qKyDH8HPpkS3YfwF8/OQtrZo7hQXxvNmP2HcH/K7zcweD00BaoOLiYUtXRItGYbl06sVSbm04soRf1Jqpyo3XiRqBWD9rmJfr4w8NOEGVGUCKXLDLsXy+8JC4Iqf0FsIjWxjMVdraTUtCbwXRbYUownQVm6bt7LYD1SNPoWNPqUJgsLMwP33ugrb1UbHCs24roOch6Go5QHIPA8E15SZE9pkr1SkmqrNs/+KRomFJ9HyFnWUYhZIV9MRLqlOAt6XBBTash3WJnCjhx/PZGhXVvdn2jX4+0Pm55LsiNugA8vaAUJQBxD/8a1u/RvTgbj35+b7I7m8tG0hMhClNZF+tpsOmZZhUGuXH9uVbkJMlMuAmMVCHwn3O31GlLeXXzzep2WS3xN2U+p5J0I7GySnuZUkuGs1ZTVqGUvR2g4q+7ljU55Ak78yPZiQXeUeqS74azszvZvCqWxXn2eePj+gcpliOjrYKpglUP19rQrMt8PqLt8L0ghIqVCmMwl3Hgr/VUcqDpXdpPTR=',
	Timezone: 'Mon Feb 23 2026 22:06:02 GMT+0800',
	Version: '0.2.7',
	Origin: 'https://chat.qwen.ai',
};

const MODEL_ALIASES: Record<string, string> = {
	qwen: 'qwen3-max',
	qwen3: 'qwen3-max',
	'qwen3.5': 'qwen3.5-plus',
	'qwen3-coder': 'qwen3-coder-plus',
	'qwen3-vl': 'qwen3-vl-235b-a22b',
	'qwen3-omni': 'qwen3-omni-flash',
	'qwen2.5': 'qwen2.5-max',
};

interface QwenAiMessage {
	role: 'user' | 'assistant' | 'system';
	content: string;
}

interface ChatCompletionRequest {
	model: string;
	/** Original model name before mapping (used for feature detection like thinking mode) */
	originalModel?: string;
	messages: QwenAiMessage[];
	stream?: boolean;
	temperature?: number;
	enable_thinking?: boolean;
	enableThinking?: boolean;
	thinking_mode?: string;
	thinkingMode?: string;
	reasoning_effort?: string;
	reasoning?: {effort?: string};
	thinking_budget?: number;
	chatId?: string;
	/** Session ID for multi-turn conversation management */
	sessionId?: string;
	/** Provider-specific session ID (for resuming upstream sessions) */
	providerSessionId?: string;
	/** Parent message ID for context (for multi-turn conversation) */
	parentMessageId?: string;
	file_ids?: string[];
	files?: QwenFileRef[];
	/** AbortSignal for cancellation (passed to axios) */
	signal?: AbortSignal;
}

interface QwenFileRef {
	file_id: string;
	url: string;
	file_url?: string;
	name?: string;
	filename?: string;
	file_name?: string;
	file_path?: string;
	size?: number;
	filetype?: string;
	file_type?: string;
	content_type?: string;
	created_at?: number;
	update_at?: number;
	user_id?: string;
}

interface QwenStatusItem {
	file_id?: string;
	status?: string;
	error_msg?: string;
	error_code?: string | null;
	retry?: boolean;
}

function uuid(): string {
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
		const r = (Math.random() * 16) | 0;
		const v = c === 'x' ? r : (r & 0x3) | 0x8;
		return v.toString(16);
	});
}

function timestamp(): number {
	return Date.now();
}

export function buildQwenAiHeaders(
	token: string,
	cookies?: string,
	chatId?: string,
): Record<string, string> {
	const headers: Record<string, string> = {
		...DEFAULT_HEADERS,
		Authorization: `Bearer ${token}`,
		'X-Request-Id': uuid(),
		Timezone: new Date().toString(),
		Version: '0.2.50',
	};

	if (chatId) {
		headers['Referer'] = `https://chat.qwen.ai/c/${chatId}`;
	}

	if (cookies) {
		headers['Cookie'] = cookies;
	}

	return headers;
}

export class QwenAiAdapter {
	private provider: Provider;
	private account: Account;
	private axiosInstance = axios.create({
		timeout: 120000,
		maxBodyLength: Infinity,
		maxContentLength: Infinity,
	});
	private lastWireDebug: Record<string, any> | null = null;

		// Track chats that currently have an active in-flight completion request.
		// This prevents concurrent `POST /chat/completions` for the same chatId
		// and ensures we don't create or switch chat IDs while a chat is pending.
		private inFlightChats: Set<string> = new Set();

		private async acquireChatLock(chatId: string, maxAttempts = 60, delayMs = 200): Promise<void> {
			if (!chatId) return; // nothing to lock
			let attempts = 0;
			while (this.inFlightChats.has(chatId)) {
				if (attempts++ >= maxAttempts) {
					throw new Error(`Timed out waiting for chat ${chatId} to become free`);
				}
				await new Promise(res => setTimeout(res, delayMs));
			}
			this.inFlightChats.add(chatId);
		}

		private releaseChatLock(chatId: string): void {
			try {
				if (chatId && this.inFlightChats.has(chatId)) {
					this.inFlightChats.delete(chatId);
				}
			} catch (e) {
				// ignore
			}
		}

	constructor(provider: Provider, account: Account) {
		this.provider = provider;
		this.account = account;
	}

	private getToken(): string {
		const credentials = this.account.credentials;
		return (
			credentials.token || credentials.accessToken || credentials.apiKey || ''
		);
	}

	private getCookies(): string {
		const credentials = this.account.credentials;
		return credentials.cookies || credentials.cookie || '';
	}

	private getHeaders(chatId?: string): Record<string, string> {
		const headers = buildQwenAiHeaders(this.getToken(), this.getCookies(), chatId);
		const cookies = this.getCookies();
		if (!cookies) {
			console.warn(
				'[QwenAI] Warning: No cookies provided. This may cause Bad_Request error.',
			);
			console.warn(
				'[QwenAI] Required cookies: cnaui, aui, sca, xlly_s, cna, token, _bl_uid, x-ap',
			);
		}

		return headers;
	}

	private maskHeadersForDebug(headers: Record<string, string>): Record<string, string> {
		const masked: Record<string, string> = {...headers};
		if (masked.Authorization) masked.Authorization = 'Bearer ***';
		if (masked.Cookie) {
			masked.Cookie = masked.Cookie
				.split(';')
				.map(x => x.trim())
				.map(p => {
					const i = p.indexOf('=');
					if (i <= 0) return p;
					return `${p.slice(0, i)}=***`;
				})
				.join('; ');
		}
		return masked;
	}

	getLastWireDebug(): Record<string, any> | null {
		return this.lastWireDebug;
	}

	private getWireLogDir(): string {
		return process.env.QWEN_WIRE_LOG_DIR || path.join(process.cwd(), 'data', 'wire-logs');
	}

	private writeWireLog(entry: Record<string, any>): void {
		try {
			const dir = this.getWireLogDir();
			if (!fs.existsSync(dir)) fs.mkdirSync(dir, {recursive: true});
			const filePath = path.join(
				dir,
				`qwen-wire-${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random()
					.toString(36)
					.slice(2, 8)}.json`,
			);
			fs.writeFileSync(filePath, JSON.stringify(entry, null, 2), 'utf8');
			console.log('[QwenAI] Wire log written:', filePath);
		} catch (err) {
			console.warn('[QwenAI] Failed to write wire log:', err);
		}
	}

	private tapWireStream(stream: any, meta: Record<string, any>): any {
		try {
			if (!stream || typeof stream.on !== 'function') return stream;
			const dir = this.getWireLogDir();
			if (!fs.existsSync(dir)) fs.mkdirSync(dir, {recursive: true});
			const filePath = path.join(
				dir,
				`qwen-stream-${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 8)}.log`,
			);
			const out = fs.createWriteStream(filePath, {flags: 'a'});
			out.write(`# ${JSON.stringify({timestamp: new Date().toISOString(), ...meta, filePath})}\n`);
			stream.on('data', (chunk: Buffer) => {
				out.write('\n--- chunk ---\n');
				out.write(chunk.toString('utf8'));
			});
			stream.on('end', () => {
				out.write('\n--- end ---\n');
				out.end();
			});
			stream.on('close', () => {
				if (!out.closed) out.end();
			});
			stream.on('error', (err: Error) => {
				out.write(`\n--- error ---\n${String(err?.stack || err)}\n`);
				out.end();
			});
			console.log('[QwenAI] Stream wire log tapped:', filePath);
			return stream;
		} catch (err) {
			console.warn('[QwenAI] Failed to tap wire stream:', err);
			return stream;
		}
	}

	private async postQwenStatus(
		pathname: string,
		body: Record<string, any>,
		chatId?: string,
	): Promise<AxiosResponse> {
		const url = `${QWEN_AI_BASE}${pathname}`;
		const response = await this.axiosInstance.post(url, body, {
			headers: this.getHeaders(chatId),
			timeout: 30000,
			validateStatus: () => true,
		});
		this.writeWireLog({
			timestamp: new Date().toISOString(),
			type: 'status',
			url,
			chatId,
			body,
			response: {
				status: response.status,
				headers: response.headers,
				body: response.data,
			},
		});
		console.log(
			'[QwenAI] Status response:',
			JSON.stringify({path: pathname, status: response.status, data: response.data}),
		);
		return response;
	}

	async waitForFileParseStatus(
		fileId: string,
		chatId?: string,
		maxAttempts = 10,
		delayMs = 1000,
	): Promise<void> {
		for (let i = 1; i <= maxAttempts; i++) {
			const response = await this.postQwenStatus(
				'/api/v2/files/parse/status',
				{file_id_list: [fileId]},
				chatId,
			);
			if (response.status >= 400) {
				throw new Error(
					`parse/status failed: status=${response.status} body=${JSON.stringify(response.data || {})}`,
				);
			}
			const items = response.data?.data;
			const list: QwenStatusItem[] = Array.isArray(items) ? items : [];
			const item = list.find(x => x.file_id === fileId) || list[0];
			const status = String(item?.status || '').toLowerCase();
			if (status === 'success' || status === 'parsed' || status === 'done') {
				return;
			}
			if (i < maxAttempts) {
				await new Promise(resolve => setTimeout(resolve, delayMs));
			}
		}
		throw new Error(`Timed out waiting for parse/status success for file ${fileId}`);
	}

	mapModel(openaiModel: string): string {
		let model = openaiModel;
		let forceThinking: boolean | undefined;

		if (model.endsWith('-thinking')) {
			forceThinking = true;
			model = model.slice(0, -9);
		} else if (model.endsWith('-fast')) {
			forceThinking = false;
			model = model.slice(0, -5);
		}

		(this as any)._forceThinking = forceThinking;

		const lowerModel = model.toLowerCase();

		if (MODEL_ALIASES[lowerModel]) {
			return MODEL_ALIASES[lowerModel];
		}

		if ((this.provider as any).modelMappings) {
			for (const [key, value] of Object.entries((this.provider as any).modelMappings)) {
				if (key.toLowerCase() === lowerModel) {
					return String(value);
				}
			}
		}

		return model;
	}

	async createChat(
		modelId: string,
		title: string = 'New Chat',
	): Promise<string> {
		const url = `${QWEN_AI_BASE}/api/v2/chats/new`;
		const payload = {
			title,
			models: [modelId],
			chat_mode: 'normal',
			chat_type: 't2t',
			timestamp: Date.now(),
			project_id: '',
		};

		try {
			const response = await this.axiosInstance.post(url, payload, {
				headers: this.getHeaders(),
			});

			console.log(
				'[QwenAI] Create chat response:',
				JSON.stringify(response.data, null, 2),
			);

			if (response.data?.data?.id) {
				console.log('[QwenAI] Created chat:', response.data.data.id);
				return response.data.data.id;
			}

			throw new Error('Failed to create chat: no chat ID returned');
		} catch (error) {
			console.error('[QwenAI] Failed to create chat:', error);
			throw error;
		}
	}

	async deleteChat(chatId: string): Promise<boolean> {
		const url = `${QWEN_AI_BASE}/api/v2/chats/${chatId}`;

		try {
			const response = await this.axiosInstance.delete(url, {
				headers: this.getHeaders(),
			});

			if (response.data?.success) {
				console.log('[QwenAI] Deleted chat:', chatId);
				return true;
			}

			console.warn('[QwenAI] Failed to delete chat:', response.data);
			return false;
		} catch (error) {
			console.error('[QwenAI] Failed to delete chat:', error);
			return false;
		}
	}

	/**
	 * Delete all chats for the current account
	 * @returns Promise<boolean> - true if deletion was successful
	 */
	async deleteAllChats(): Promise<boolean> {
		const url = `${QWEN_AI_BASE}/api/v2/chats/`;

		try {
			console.log('[QwenAI] Deleting all chats for account');

			const response = await this.axiosInstance.delete(url, {
				headers: this.getHeaders(),
			});

			if (response.data?.success) {
				console.log('[QwenAI] All chats deleted successfully');
				return true;
			}

			console.warn('[QwenAI] Failed to delete all chats:', response.data);
			return false;
		} catch (error) {
			console.error('[QwenAI] Failed to delete all chats:', error);
			return false;
		}
	}

	async getChatById(chatId: string): Promise<any | null> {
		const url = `${QWEN_AI_BASE}/api/v2/chats/${chatId}`;
		try {
			const response = await this.axiosInstance.get(url, {
				headers: this.getHeaders(chatId),
				timeout: 20000,
				validateStatus: () => true,
			});
			if (response.status !== 200 || !response.data?.success) {
				return null;
			}
			return response.data?.data || null;
		} catch {
			return null;
		}
	}

	async chatCompletion(request: ChatCompletionRequest): Promise<{
		response: AxiosResponse;
		chatId: string;
		parentId: string | null;
	}> {
		const token = this.getToken();
		if (!token) {
			throw new Error(
				'Qwen AI token not configured, please add token in account settings',
			);
		}

		const modelId = this.mapModel(request.model);

		// Get forced thinking mode setting from originalModel (preserves user's intent before mapping)
		// If originalModel exists, use it for thinking detection; otherwise fall back to request.model
		const modelForThinking = request.originalModel || request.model;
		const modelLower = modelForThinking.toLowerCase();
		let forceThinking: boolean | undefined;
		if (modelForThinking.endsWith('-thinking')) {
			forceThinking = true;
		} else if (modelForThinking.endsWith('-fast')) {
			forceThinking = false;
		} else if (modelLower.includes('think') || modelLower.includes('r1')) {
			// Auto-enable thinking based on model name keywords (e.g. "Qwen3.5-Plus-AI-Think-Search")
			forceThinking = true;
			console.log('[QwenAI] Thinking mode enabled (from model name keyword)');
		} else {
			// Use the forceThinking from mapModel if no originalModel-specific detection
			forceThinking = (this as any)._forceThinking;
		}

		// Use existing chat ID if provided (multi-turn conversation), otherwise create new chat.
		// If Qwen reports the chat is still in progress, retry once with a fresh chat ID.
		await this.postQwenStatus('/api/v2/users/status', {status: true}, request.providerSessionId);
		let chatId = request.providerSessionId;
		if (!chatId) {
			chatId = await this.createChat(modelId, 'OpenAI_API_Chat');
			console.log('[QwenAI] Created new chat:', chatId);
		} else {
			console.log('[QwenAI] Reusing existing chat:', chatId);
		}

		const messages = request.messages as any[];

		// Extract system message and user message
		let systemContent = '';
		let userContent = '';

		// Single-turn mode: extract all messages
		for (const msg of messages) {
			if (msg.role === 'system') {
				systemContent += (systemContent ? '\n\n' : '') + msg.content;
			} else if (msg.role === 'user') {
				if (typeof msg.content === 'string') {
					userContent = msg.content;
				} else if (Array.isArray(msg.content)) {
					const textParts = msg.content
						.filter((p: any) => p && p.type === 'text' && typeof p.text === 'string')
						.map((p: any) => p.text);
					userContent = textParts.join('\n');
				}
			}
		}

		const dedup = new Set<string>();
		const extractedFiles: QwenFileRef[] = [];
		const normalizeFileUrl = (value: any): string => {
			if (!value) return '';
			if (typeof value === 'string') return value.trim();
			if (typeof value === 'object') {
				if (typeof value.url === 'string') return value.url.trim();
				if (typeof value.file_url === 'string') return value.file_url.trim();
			}
			return '';
		};
		const pushFile = (id?: string, url?: string, meta?: Record<string, any>) => {
			if (!id || dedup.has(id)) return;
			// Qwen currently validates files[].url as required.
			const normalizedUrl = normalizeFileUrl(url);
			if (!normalizedUrl) return;
			dedup.add(id);
			extractedFiles.push({
				...(meta || {}),
				file_id: id,
				url: normalizedUrl,
				file_url: normalizeFileUrl((meta || {}).file_url) || normalizedUrl,
			});
		};

		if (Array.isArray(request.files)) {
			for (const f of request.files) {
				if (!f || typeof f !== 'object') continue;
				pushFile(
					(f as any).file_id || (f as any).fileId || (f as any).id,
					(f as any).url || (f as any).file_url,
					f as any,
				);
			}
		}

		for (const msg of messages) {
			if (!msg || msg.role !== 'user') continue;
			if (Array.isArray(msg.content)) {
					for (const part of msg.content) {
						if (!part || typeof part !== 'object') continue;
						pushFile(
							part.file_id || part.fileId || part.id,
							part.url || part.file_url,
							part,
						);
					}
				}
				if (Array.isArray((msg as any).files)) {
				for (const f of (msg as any).files) {
					if (!f || typeof f !== 'object') continue;
						const nestedFile = (f as any).file && typeof (f as any).file === 'object' ? (f as any).file : {};
						pushFile(
							(f as any).file_id || (f as any).fileId || (f as any).id || nestedFile.id,
							(f as any).url || (f as any).file_url,
							{
								...nestedFile,
								...(f as any),
							} as any,
						);
					}
				}
			}

		if (Array.isArray(request.file_ids)) {
			for (const id of request.file_ids) pushFile(id);
		}

			// Ensure any attached files have finished parsing on Qwen side before sending chat.
			// This avoids upstream "Internal error" when files are not ready yet.
			try {
				const allFileIds: string[] = [];
				for (const f of extractedFiles) {
					if (f && f.file_id) allFileIds.push(f.file_id);
				}
				if (Array.isArray(request.file_ids)) {
					for (const id of request.file_ids) if (id) allFileIds.push(id);
				}
				// Deduplicate
				const uniqueFileIds = Array.from(new Set(allFileIds));
				for (const fid of uniqueFileIds) {
					if (!fid) continue;
					try {
						await this.waitForFileParseStatus(fid, chatId);
						console.log('[QwenAI] file parse ready:', fid);
					} catch (err) {
						console.warn('[QwenAI] waitForFileParseStatus failed for', fid, err);
					}
				}
			} catch (err) {
				console.warn('[QwenAI] Error while waiting for file parse status:', err);
			}

		// If system prompt exists, prepend it to user content
		if (systemContent) {
			userContent = `${systemContent}\n\nUser: ${userContent}`;
		}

		const fid = uuid();
		const childId = uuid();
		const ts = Math.floor(Date.now() / 1000);

		// Qwen web exposes three modes:
		// - Thinking: thinking_enabled=true, auto_thinking=false
		// - Auto:     thinking_enabled=true, auto_thinking=true
		// - Fast:     thinking_enabled=false, auto_thinking=false
		// Keep Fast as the default to preserve historical proxy behavior.
		const explicitThinkingMode = String(
			request.thinking_mode ||
				request.thinkingMode ||
				(request as any).qwen_thinking_mode ||
				(request as any).qwenThinkingMode ||
				'',
		).toLowerCase();
		const reasoningEffort = String(
			request.reasoning_effort ||
				request.reasoning?.effort ||
				(request as any).reasoningEffort ||
				'',
		).toLowerCase();
		const requestedEnableThinking =
			typeof request.enable_thinking === 'boolean'
				? request.enable_thinking
				: typeof request.enableThinking === 'boolean'
					? request.enableThinking
					: undefined;

		let qwenThinkingMode: 'Thinking' | 'Auto' | 'Fast' = 'Fast';
		if (explicitThinkingMode === 'auto' || reasoningEffort === 'auto') {
			qwenThinkingMode = 'Auto';
		} else if (
			explicitThinkingMode === 'thinking' ||
			explicitThinkingMode === 'think' ||
			explicitThinkingMode === 'on' ||
			reasoningEffort === 'low' ||
			reasoningEffort === 'medium' ||
			reasoningEffort === 'high' ||
			reasoningEffort === 'xhigh' ||
			reasoningEffort === 'max'
		) {
			qwenThinkingMode = 'Thinking';
		} else if (
			explicitThinkingMode === 'fast' ||
			explicitThinkingMode === 'off' ||
			explicitThinkingMode === 'none' ||
			reasoningEffort === 'none' ||
			reasoningEffort === 'minimal' ||
			reasoningEffort === 'fast'
		) {
			qwenThinkingMode = 'Fast';
		} else if (forceThinking === true || requestedEnableThinking === true) {
			qwenThinkingMode = 'Thinking';
		} else if (forceThinking === false || requestedEnableThinking === false) {
			qwenThinkingMode = 'Fast';
		}

		const shouldEnableThinking = qwenThinkingMode !== 'Fast';
		const shouldAutoThink = qwenThinkingMode === 'Auto';

		const featureConfig: Record<string, any> = {
			thinking_enabled: shouldEnableThinking,
			output_schema: 'phase',
			research_mode: 'normal',
			auto_thinking: shouldAutoThink,
			thinking_mode: qwenThinkingMode,
			thinking_format: 'summary',
			auto_search: false, // Default to disable auto search
		};

		if (request.thinking_budget) {
			featureConfig.thinking_budget = request.thinking_budget;
		}

		const qwenMessageFiles = extractedFiles
			.filter(file => file.file_id && file.url)
			.map(file => {
				const fileName = file.filename || file.file_name || file.name || 'overflow.txt';
				const size = typeof file.size === 'number' ? file.size : 0;
				const rawContentType = file.content_type || file.file_type || file.filetype || '';
				const contentType = rawContentType && rawContentType !== 'file'
					? rawContentType
					: 'text/plain';
				const createdAt = file.created_at || timestamp();
				const userId = file.user_id || '';
				return {
					type: 'file',
					file: {
						created_at: createdAt,
						data: {},
						filename: fileName,
						hash: null,
						id: file.file_id,
						user_id: userId,
						meta: {
							name: fileName,
							size,
							content_type: contentType,
							parse_meta: {
								parse_status: 'success',
							},
						},
						update_at: file.update_at || createdAt,
					},
					id: file.file_id,
					url: file.url,
					name: fileName,
					collection_name: '',
					progress: 0,
					status: 'uploaded',
					greenNet: 'success',
					size,
					error: '',
					itemId: uuid(),
					file_type: contentType,
					showType: 'file',
					file_class: 'document',
					uploadTaskId: uuid(),
				};
			});

		const payload = {
			stream: true,
			version: '2.1',
			incremental_output: true,
			chat_id: chatId,
			chat_mode: 'normal',
			model: modelId,
			parent_id: request.parentMessageId || null,
			messages: [
				{
					fid,
					parentId: null,
					childrenIds: [childId],
					role: 'user',
					content: userContent,
					user_action: 'chat',
					files: qwenMessageFiles,
					timestamp: ts,
					models: [modelId],
					chat_type: 't2t',
					feature_config: featureConfig,
					extra: {meta: {subChatType: 't2t'}},
					sub_chat_type: 't2t',
					parent_id: request.parentMessageId || null,
				},
			],
			timestamp: ts + 1,
			...(qwenMessageFiles.length === 0 ? {file_ids: Array.from(new Set([
				...extractedFiles.map(f => f.file_id).filter(Boolean),
				...(Array.isArray(request.file_ids) ? request.file_ids : []),
			]))} : {}),
		};

		// Try sending the chat completion request multiple times but do NOT create
		// a new chat on retry. Always reuse the same `chatId` (created earlier
		// or passed via `providerSessionId`). Recompute the request URL each
		// attempt so query param and body stay in sync.

		// Acquire a per-chat lock to prevent concurrent POSTs to the same chatId.
		// This ensures we don't change or recreate the chat while a request
		// is still in progress for that chat.
		await this.acquireChatLock(chatId);

		const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));
		let response: AxiosResponse | undefined;
		let lastErrorBody: any = null;
		try {
			// Single POST attempt (no retry). If the upstream stream immediately
			// emits an error or reports "chat in progress", abort and surface
			// the error to the caller.
			payload.chat_id = chatId;
			payload.messages[0].parent_id = request.parentMessageId || null;
			const url = `${QWEN_AI_BASE}/api/v2/chat/completions?chat_id=${chatId}`;

			console.log('[QwenAI] Sending request to /api/v2/chat/completions...');
			console.log('[QwenAI] Request URL:', url);
			console.log('[QwenAI] Request payload:', JSON.stringify(payload, null, 2));
			console.log('[QwenAI] Request headers:', JSON.stringify(this.getHeaders(chatId), null, 2));

			const axiosConfig: any = {
				headers: {
					...this.getHeaders(chatId),
					'x-accel-buffering': 'no',
				},
				responseType: 'stream',
				timeout: 120000,
				validateStatus: () => true,
			};
			if (request.signal) {
				axiosConfig.signal = request.signal;
			}
			response = await this.axiosInstance.post(url, payload, axiosConfig);

			const currentResponse = response;
			if (!currentResponse) {
				this.releaseChatLock(chatId);
				throw new Error('Qwen chat completion failed: missing response');
			}

			this.lastWireDebug = {
				attempt: 1,
				url,
				payload,
				requestHeaders: this.maskHeadersForDebug({
					...this.getHeaders(chatId),
					'x-accel-buffering': 'no',
				}),
				responseStatus: currentResponse.status,
				responseHeaders: currentResponse.headers,
			};

			console.log('[QwenAI] Response status:', currentResponse.status);
			console.log('[QwenAI] Response headers:', JSON.stringify(currentResponse.headers, null, 2));

			this.writeWireLog({
				timestamp: new Date().toISOString(),
				attempt: 1,
				url,
				request: {
					headers: this.maskHeadersForDebug({
						...this.getHeaders(chatId),
						'x-accel-buffering': 'no',
					}),
					body: payload,
				},
				response: {
					status: currentResponse.status,
					headers: currentResponse.headers,
					body: typeof currentResponse.data === 'string' ? currentResponse.data : undefined,
				},
			});

			const responseBody = currentResponse.data;
			lastErrorBody = responseBody;

			// Peek the first upstream chunk so early provider errors are visible
			// in wire logs instead of becoming an empty client response.
			if (currentResponse.status === 200 && currentResponse.data && typeof currentResponse.data.on === 'function') {
				const stream = currentResponse.data as NodeJS.ReadableStream & { unshift?: (chunk: any) => void };
				const peek = await new Promise<{isError: boolean; text: string; ended: boolean}>(resolve => {
					let resolved = false;
					const onData = (chunk: Buffer | string) => {
						if (resolved) return;
						resolved = true;
						const s = chunk.toString('utf8');
						let isError = false;
						try {
							if (/"error"\s*:\s*"[^"]+"/i.test(s) || /The chat is in progress/i.test(s) || /"success"\s*:\s*false/i.test(s)) {
								const lines = s.split(/\r?\n/);
								for (const line of lines) {
									const t = line.trim();
									if (!t) continue;
									const payloadStr = t.startsWith('data:') ? t.slice(5).trim() : t;
									try {
										const obj = JSON.parse(payloadStr);
										if (obj && (obj.error || (obj.success === false && obj.data && /The chat is in progress/i.test(JSON.stringify(obj.data || {}))))) {
											isError = true;
											break;
										}
									} catch (e) {
										// ignore parse errors
									}
								}
							}
						} catch (e) {}
						try {
							if (typeof stream.unshift === 'function') stream.unshift(chunk as any);
						} catch (e) {}
						cleanup();
						return resolve({isError, text: s.slice(0, 4000), ended: false});
					};
					const onEnd = () => {
						if (!resolved) {
							resolved = true;
							cleanup();
							resolve({isError: true, text: '', ended: true});
						}
					};
					const onError = (err: Error) => {
						if (!resolved) {
							resolved = true;
							cleanup();
							resolve({isError: true, text: String(err?.stack || err), ended: false});
						}
					};
					const cleanup = () => {
						stream.removeListener('data', onData as any);
						stream.removeListener('end', onEnd as any);
						stream.removeListener('error', onError as any);
					};
					stream.once('data', onData as any);
					stream.once('end', onEnd as any);
					stream.once('error', onError as any);
					setTimeout(() => {
						if (!resolved) {
							resolved = true;
							cleanup();
							resolve({isError: false, text: '', ended: false});
						}
					}, 1500);
				});

				if (peek.text || peek.ended || peek.isError) {
					this.writeWireLog({
						timestamp: new Date().toISOString(),
						attempt: 1,
						type: 'stream-peek',
						url,
						chatId,
						endedBeforeData: peek.ended,
						immediateError: peek.isError,
						firstChunk: peek.text,
					});
				}

				if (peek.isError && !peek.text) {
					console.warn('[QwenAI] Upstream stream ended before first SSE data');
				}
			}

			if (currentResponse.status >= 400) {
				this.releaseChatLock(chatId);
				throw new Error(`Qwen chat completion failed: status=${currentResponse.status} body=${JSON.stringify(lastErrorBody || {})}`);
			}
		} catch (err) {
			this.releaseChatLock(chatId);
			throw err;
		}

		// Ensure the chat lock is released when the stream finishes, closes,
		// or errors. Also post the user status as before.
		const releaseAndPostStatus = () => {
			this.releaseChatLock(chatId);
			void this.postQwenStatus('/api/v2/users/status', {status: true}, chatId).catch(err => {
				console.warn('[QwenAI] Failed to post users/status after stream end/close/error:', err);
			});
		};


		// Derive a stable URL for logging: prefer lastWireDebug.url, then
		// the actual response config URL, and finally fallback to a
		// constructed URL using the chatId. This prevents mismatches between
		// the logged URL and the current `chatId` when retries occur.
		const finalUrl = (this.lastWireDebug && (this.lastWireDebug as any).url)
			|| (response as any)?.config?.url
			|| `${QWEN_AI_BASE}/api/v2/chat/completions?chat_id=${chatId}`;

		if (!response) {
			// Ensure lock is released if response is unexpectedly missing.
			this.releaseChatLock(chatId);
			throw new Error('Missing response from Qwen chat completion');
		}

		// Tap and attach handlers to the actual response stream.
		response.data = this.tapWireStream(response.data, {
			attempt: this.lastWireDebug?.attempt,
			url: finalUrl,
			chatId,
		});

		// Attach release/status handlers to the tapped stream so the lock
		// is released when the stream handed back to the client finishes.
		if (response.data && typeof response.data.once === 'function') {
			response.data.once('end', releaseAndPostStatus);
			response.data.once('close', releaseAndPostStatus);
			response.data.once('error', (err: any) => {
				console.warn('[QwenAI] Stream error for chat', chatId, err);
				releaseAndPostStatus();
			});
		} else {
			// If stream is not present, release lock immediately.
			this.releaseChatLock(chatId);
		}

		return {
			response,
			chatId,
			parentId: null,
		};
	}

	static isQwenAiProvider(provider: Provider): boolean {
		return (
			provider.id === 'qwen-ai' || provider.apiEndpoint.includes('chat.qwen.ai')
		);
	}
}

export class QwenAiStreamHandler {
	private chatId: string = '';
	private model: string;
	private created: number;
	private onEnd?: (chatId: string) => void;
	private responseId: string = '';
	private content: string = '';
	private toolCallsSent: boolean = false;
	xmlPassthrough: boolean = true;
	leakDetected: boolean = false;
	leakReason: string = '';

	constructor(model: string, onEnd?: (chatId: string) => void) {
		this.model = model;
		this.created = Math.floor(Date.now() / 1000);
		this.onEnd = onEnd;
	}

	setChatId(chatId: string) {
		this.chatId = chatId;
	}

	private sendToolCalls(transStream: PassThrough): void {
		if (this.toolCallsSent) return;

		const toolCalls = parseToolUse(this.content);
		if (toolCalls && toolCalls.length > 0) {
			this.toolCallsSent = true;

			// If the transStream is already ended, bail out to avoid
			// "write after end" errors.
			if ((transStream as any).writableEnded) return;

			// Send tool_calls delta
			for (let i = 0; i < toolCalls.length; i++) {
				if ((transStream as any).writableEnded) break;
				const tc = toolCalls[i];
				try {
					transStream.write(
						`data: ${JSON.stringify({
							id: this.responseId || this.chatId,
							model: this.model,
							object: 'chat.completion.chunk',
							choices: [
								{
									index: 0,
									delta: {
										tool_calls: [
											{
												index: i,
												id: tc.id,
												type: 'function',
												function: {
													name: tc.function.name,
													arguments: tc.function.arguments,
												},
											},
										],
									},
									finish_reason: null,
								},
							],
							created: this.created,
						})}\n\n`,
					);
				} catch (e) {
					console.warn('[QwenAI] sendToolCalls write failed', e);
				}
			}

			if (!(transStream as any).writableEnded) {
				try {
					transStream.write(
						`data: ${JSON.stringify({
							id: this.responseId || this.chatId,
							model: this.model,
							object: 'chat.completion.chunk',
							choices: [{index: 0, delta: {}, finish_reason: 'tool_calls'}],
							usage: {prompt_tokens: 1, completion_tokens: 1, total_tokens: 2},
							created: this.created,
						})}\n\n`,
					);
					transStream.end('data: [DONE]\n\n');
				} catch (e) {
					console.warn('[QwenAI] sendToolCalls final write/end failed', e);
				}
			}

			if (this.onEnd && this.chatId) {
				this.onEnd(this.chatId);
			}
		}
	}

	async handleStream(stream: any): Promise<PassThrough> {
		const transStream = new PassThrough();

		console.log('[QwenAI] Starting stream handler...');

		let reasoningText = '';
		let hasSentReasoning = false;
		let summaryText = '';
		let initialChunkSent = false;
		let sawAnswerContent = false;
		let ended = false;

		const safeWrite = (data: string) => {
			if (ended) return;
			try {
				transStream.write(data);
			} catch (e) {
				console.warn('[QwenAI] safeWrite failed', e);
			}
		};

		const safeEnd = (data?: string) => {
			if (ended) return;
			ended = true;
			try {
				if (data) transStream.end(data);
				else transStream.end();
			} catch (e) {
				console.warn('[QwenAI] safeEnd failed', e);
			}
		};

		const sendInitialChunk = () => {
			if (!initialChunkSent) {
				const initialChunk = `data: ${JSON.stringify({
					id: '',
					model: this.model,
					object: 'chat.completion.chunk',
					choices: [
						{
							index: 0,
							delta: {role: 'assistant', content: ''},
							finish_reason: null,
						},
					],
					created: this.created,
				})}\n\n`;
				safeWrite(initialChunk);
				initialChunkSent = true;
				console.log('[QwenAI] Initial chunk written');
			}
		};

		const parser = createParser({
			onEvent: (event: any) => {
				try {
					console.log(
						'[QwenAI] Parsed event:',
						event.event,
						'data:',
						event.data?.substring(0, 200),
					);

					if (event.data === '[DONE]') {
						console.log('[QwenAI] Received [DONE] signal');
						return;
					}

					const data = JSON.parse(event.data);
					console.log('[QwenAI] Parsed JSON data keys:', Object.keys(data));

					if (data['response.created']?.response_id) {
						this.responseId = data['response.created'].response_id;
						console.log('[QwenAI] Got response_id:', this.responseId);
					}

					if (data.choices && data.choices.length > 0) {
						const choice = data.choices[0];
						const delta = choice.delta || {};
						const phase = delta.phase;
						const status = delta.status;
						const content = delta.content || '';

						console.log(
							'[QwenAI] Phase:',
							phase,
							'Status:',
							status,
							'Content:',
							content.substring(0, 50),
						);

						if (phase === 'think') {
							if (status !== 'finished') {
								// Stream thinking content as reasoning_content in real-time
								reasoningText += content;
								if (!hasSentReasoning) {
									safeWrite(
										`data: ${JSON.stringify({
											id: this.responseId || this.chatId,
											model: this.model,
											object: 'chat.completion.chunk',
											choices: [
												{
													index: 0,
													delta: {role: 'assistant', reasoning_content: ''},
													finish_reason: null,
												},
											],
											created: this.created,
										})}\n\n`,
									);
									hasSentReasoning = true;
									console.log('[QwenAI] Sent reasoning role chunk');
								}
								if (content) {
									safeWrite(
										`data: ${JSON.stringify({
											id: this.responseId || this.chatId,
											model: this.model,
											object: 'chat.completion.chunk',
											choices: [
												{
													index: 0,
													delta: {reasoning_content: content},
													finish_reason: null,
												},
											],
											created: this.created,
										})}\n\n`,
									);
								}
							}
							// When status === 'finished', the think phase is done
						} else if (phase === 'thinking_summary') {
							const extra = delta.extra || {};
							console.log(
								'[QwenAI] thinking_summary extra:',
								JSON.stringify(extra).substring(0, 300),
							);
							if (extra.summary_thought?.content) {
								const newSummary = extra.summary_thought.content.join('\n');
								if (newSummary && newSummary.length > summaryText.length) {
									// Send only the incremental diff as reasoning_content
									const diff = newSummary.substring(summaryText.length);
									if (diff) {
										if (!hasSentReasoning) {
											transStream.write(
												`data: ${JSON.stringify({
													id: this.responseId || this.chatId,
													model: this.model,
													object: 'chat.completion.chunk',
													choices: [
														{
															index: 0,
															delta: {role: 'assistant', reasoning_content: ''},
															finish_reason: null,
														},
													],
													created: this.created,
												})}\n\n`,
											);
											hasSentReasoning = true;
										}
										transStream.write(
											`data: ${JSON.stringify({
												id: this.responseId || this.chatId,
												model: this.model,
												object: 'chat.completion.chunk',
												choices: [
													{
														index: 0,
														delta: {reasoning_content: diff},
														finish_reason: null,
													},
												],
												created: this.created,
											})}\n\n`,
										);
									}
									summaryText = newSummary;
									console.log(
										'[QwenAI] Updated summaryText, length:',
										summaryText.length,
									);
								}
							}
						} else if (phase === 'answer') {
							if (!initialChunkSent) {
								sendInitialChunk();
							}
							console.log('[QwenAI] Entering answer branch, content:', content);

							// Accumulate content for tool call detection
							this.content += content;
							sawAnswerContent = sawAnswerContent || !!content;

							if (content) {
								console.log('[QwenAI] Sending content chunk:', content);
								const chunk = {
									id: this.responseId || this.chatId,
									model: this.model,
									object: 'chat.completion.chunk',
									choices: [{index: 0, delta: {content}, finish_reason: null}],
									created: this.created,
								};
								safeWrite(`data: ${JSON.stringify(chunk)}\n\n`);
								console.log('[QwenAI] Content chunk written');
							}
						} else if (phase === null && content) {
							if (!initialChunkSent) {
								sendInitialChunk();
							}
							// Accumulate content for tool call detection
							this.content += content;
							sawAnswerContent = sawAnswerContent || !!content;

							const chunk = {
								id: this.responseId || this.chatId,
								model: this.model,
								object: 'chat.completion.chunk',
								choices: [{index: 0, delta: {content}, finish_reason: null}],
								created: this.created,
							};
							safeWrite(`data: ${JSON.stringify(chunk)}\n\n`);
						}

						if (
							status === 'finished' &&
							(phase === 'answer' || phase === null)
						) {
							// Check for tool calls before sending stop
							if (hasToolUse(this.content)) {
								if (!this.xmlPassthrough) {
									console.log(
										'[QwenAI] Found tool_use in stream, sending tool_calls',
									);
									this.sendToolCalls(transStream);
									return;
								}
								console.log(
									'[QwenAI] xmlPassthrough enabled, tool_use streamed as text',
								);
							}

							const finishReason = delta.finish_reason || 'stop';
							const finalChunk = {
								id: this.responseId || this.chatId,
								model: this.model,
								object: 'chat.completion.chunk',
								choices: [{index: 0, delta: {}, finish_reason: finishReason}],
								created: this.created,
							};
							safeWrite(`data: ${JSON.stringify(finalChunk)}\n\n`);
							safeEnd('data: [DONE]\n\n');

							if (this.onEnd && this.chatId) {
								this.onEnd(this.chatId);
							}
						}
					}
				} catch (err) {
					console.error('[QwenAI] Stream parse error:', err);
				}
			},
		});

		stream.on('data', (buffer: Buffer) => {
			const text = buffer.toString();
			console.log('[QwenAI] Raw stream data:', text.substring(0, 500));
			parser.feed(text);
		});
		const finalizeStream = () => {
			if (sawAnswerContent) return;
			const fallbackContent = reasoningText || summaryText;
			if (!fallbackContent) return;
			if (!initialChunkSent) {
				sendInitialChunk();
			}
						safeWrite(
				`data: ${JSON.stringify({
					id: this.responseId || this.chatId,
					model: this.model,
					object: 'chat.completion.chunk',
					choices: [
						{
							index: 0,
							delta: {content: fallbackContent},
							finish_reason: null,
						},
					],
					created: this.created,
				})}\n\n`,
						);
		};

		stream.once('error', (err: Error) => {
			console.error('[QwenAI] Stream error:', err);
			finalizeStream();
			safeEnd('data: [DONE]\n\n');
		});
		stream.once('close', () => {
			console.log('[QwenAI] Stream closed');
			finalizeStream();
			safeEnd('data: [DONE]\n\n');
		});

		return transStream;
	}

	async handleNonStream(stream: any): Promise<any> {
		return new Promise((resolve, reject) => {
			const data = {
				id: '',
				model: this.model,
				object: 'chat.completion',
				choices: [
					{
						index: 0,
						message: {role: 'assistant', content: '', reasoning_content: ''},
						finish_reason: 'stop',
					},
				],
				usage: {prompt_tokens: 1, completion_tokens: 1, total_tokens: 2},
				created: this.created,
			};

			let reasoningText = '';
			let summaryText = '';
			let resolved = false;

			const resolveOnce = (value: any) => {
				if (!resolved) {
					resolved = true;
					resolve(value);
				}
			};

			const rejectOnce = (reason: any) => {
				if (!resolved) {
					resolved = true;
					reject(reason);
				}
			};

			const parser = createParser({
				onEvent: (event: any) => {
					try {
						if (event.data === '[DONE]') return;

						const parsed = JSON.parse(event.data);

						if (parsed['response.created']?.response_id) {
							this.responseId = parsed['response.created'].response_id;
							data.id = this.responseId;
						}

						if (parsed.choices && parsed.choices.length > 0) {
							const delta = parsed.choices[0].delta || {};
							const phase = delta.phase;
							const status = delta.status;
							const content = delta.content || '';

							if (phase === 'think' && status !== 'finished') {
								reasoningText += content;
							} else if (phase === 'thinking_summary') {
								// Handle thinking_summary phase - extract summary content
								const extra = delta.extra || {};
								if (extra.summary_thought?.content) {
									const newSummary = extra.summary_thought.content.join('\n');
									if (newSummary && newSummary.length > summaryText.length) {
										summaryText = newSummary;
									}
								}
							} else if (phase === 'answer') {
								if (content) {
									data.choices[0].message.content += content;
								}
								if (status === 'finished') {
									// Use reasoningText or summaryText for reasoning_content
									const finalReasoning = reasoningText || summaryText;
									if (finalReasoning) {
										data.choices[0].message.reasoning_content = finalReasoning;
									}

									if (this.onEnd && this.chatId) {
										this.onEnd(this.chatId);
									}

									resolveOnce(data);
								}
							} else if (phase === null && content) {
								data.choices[0].message.content += content;
							}
						}
					} catch (err) {
						console.error('[QwenAI] Non-stream parse error:', err);
						rejectOnce(err);
					}
				},
			});

			stream.on('data', (buffer: Buffer) => parser.feed(buffer.toString()));
			stream.once('error', (err: Error) => {
				console.error('[QwenAI] Non-stream error:', err);
				rejectOnce(err);
			});
			stream.once('close', () => {
				// Use reasoningText or summaryText for reasoning_content
				const finalReasoning = reasoningText || summaryText;
				if (finalReasoning) {
					data.choices[0].message.reasoning_content = finalReasoning;
				}
				resolveOnce(data);
			});
		});
	}

	getChatId(): string {
		return this.chatId;
	}

	getResponseId(): string {
		return this.responseId;
	}
}

export const qwenAiAdapter = {
	QwenAiAdapter,
	QwenAiStreamHandler,
};
