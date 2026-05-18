import axios from 'axios';

const QWEN_AI_API_BASE = 'https://chat.qwen.ai';

const FAKE_HEADERS = {
    Accept: 'application/json',
    'Accept-Encoding': 'gzip, deflate, br, zstd',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache',
    Origin: QWEN_AI_API_BASE,
    Pragma: 'no-cache',
    Referer: `${QWEN_AI_API_BASE}/`,
    'Sec-Ch-Ua':
        '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Linux"',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    'User-Agent':
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    source: 'web',
};

export class QwenAiAdapter {
    async startLogin(): Promise<any> {
        return {
            success: false,
            error: 'Use auto capture to open chat.qwen.ai and read Local Storage token',
        };
    }

    async validateToken(credentials: Record<string, string>): Promise<any> {
        const token = credentials.token || credentials.accessToken || credentials.apiKey || '';
        const cookies = credentials.cookies || credentials.cookie || '';

        if (!token && !cookies) {
            return {valid: false, error: 'No token or cookies provided'};
        }

        if (token && token.startsWith('eyJ') && token.split('.').length === 3) {
            try {
                const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
                if (payload.email && String(payload.email).includes('@guest.com')) {
                    return {valid: false, error: 'Guest account not allowed, please login with a real account'};
                }
            } catch {
                return {valid: false, error: 'Invalid JWT token'};
            }
        }

        try {
            const headers: Record<string, string> = {...FAKE_HEADERS};
            if (token) headers.Authorization = `Bearer ${token}`;
            if (cookies) headers.Cookie = cookies;

            const resp = await axios.get(`${QWEN_AI_API_BASE}/api/v2/user/info`, {
                headers,
                validateStatus: () => true,
                timeout: 15000,
            });

            if (resp.status === 200 && (resp.data?.success || resp.data?.data)) {
                return {
                    valid: true,
                    tokenType: token ? 'jwt' : 'cookie',
                    accountInfo: resp.data?.data || {},
                };
            }

            return {valid: false, error: `Unexpected response: ${resp.status}`};
        } catch (err: any) {
            return {valid: false, error: err && err.message ? err.message : String(err)};
        }
    }
}

export default QwenAiAdapter;
