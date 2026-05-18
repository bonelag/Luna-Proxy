import {QwenAiAdapter} from './adapters/qwen-ai';
import fs from 'fs';

const QWEN_AI_LOGIN_URL = 'https://chat.qwen.ai';
const DEFAULT_TIMEOUT = 300000;
const CHROME_CANDIDATES = [
    process.env.PUPPETEER_EXECUTABLE_PATH,
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
].filter(Boolean) as string[];

export interface QwenAiCaptureResult {
    success: boolean;
    credentials?: Record<string, string>;
    accountInfo?: Record<string, any>;
    error?: string;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isValidToken(value: string): boolean {
    if (!value || value.length < 5) return false;

    if (value.startsWith('eyJ')) {
        const parts = value.split('.');
        if (parts.length === 3) {
            try {
                const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
                if (payload.email && String(payload.email).includes('@guest.com')) {
                    return false;
                }
                return !!(
                    payload.app_id ||
                    payload.sub ||
                    payload.exp ||
                    payload.id ||
                    payload.user_id ||
                    payload.uid ||
                    payload.email
                );
            } catch {
                return false;
            }
        }
    }

    return value.length >= 32 && !/\s/.test(value);
}

function normalizeStorageValue(value: unknown): string {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
            const parsed = JSON.parse(trimmed);
            if (typeof parsed.value === 'string') {
                return parsed.value;
            }
            if (typeof parsed.token === 'string') {
                return parsed.token;
            }
        } catch {
            return trimmed;
        }
    }
    return trimmed;
}

function getChromeExecutablePath(): string | undefined {
    for (const candidate of CHROME_CANDIDATES) {
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return undefined;
}

export async function captureQwenAiCredentials(timeout = DEFAULT_TIMEOUT): Promise<QwenAiCaptureResult> {
    let browser: any;

    try {
        const puppeteer = await import('puppeteer');
        const executablePath = getChromeExecutablePath();
        browser = await puppeteer.launch({
            headless: false,
            executablePath,
            defaultViewport: null,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--start-maximized'],
        });

        const page = await browser.newPage();
        await page.goto(QWEN_AI_LOGIN_URL, {waitUntil: 'domcontentloaded'});

        const startedAt = Date.now();
        while (Date.now() - startedAt < timeout) {
            if (page.isClosed()) {
                return {success: false, error: 'Login window was closed'};
            }

            const storageToken = normalizeStorageValue(
                await page.evaluate(() => {
                    try {
                        return localStorage.getItem('token');
                    } catch {
                        return null;
                    }
                }).catch(() => null),
            );

            const cookies = await page.cookies();
            const cookieHeader = cookies.map((cookie: any) => `${cookie.name}=${cookie.value}`).join('; ');
            const cookieToken = cookies.find((cookie: any) => cookie.name === 'token')?.value || '';
            const token = isValidToken(storageToken) ? storageToken : cookieToken;

            if (isValidToken(token)) {
                const credentials: Record<string, string> = {token};
                if (cookieHeader) {
                    credentials.cookies = cookieHeader;
                }

                const adapter = new QwenAiAdapter();
                const validation = await adapter.validateToken(credentials);
                if (!validation.valid) {
                    return {
                        success: false,
                        error: validation.error || 'Captured token failed validation',
                    };
                }

                return {
                    success: true,
                    credentials,
                    accountInfo: validation.accountInfo,
                };
            }

            await sleep(1000);
        }

        return {success: false, error: 'Login timeout'};
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
        };
    } finally {
        if (browser) {
            await browser.close().catch(() => undefined);
        }
    }
}
