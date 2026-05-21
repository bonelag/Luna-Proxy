import crypto from 'crypto';
import https from 'https';
import axios from 'axios';
import { buildQwenAiHeaders } from '../main/proxy/adapters/qwen-ai';

export async function waitForFileParseStatus(
  fileId: string,
  headers: Record<string, string>,
  maxAttempts = 30,
  delayMs = 1000,
): Promise<void> {
  for (let i = 1; i <= maxAttempts; i++) {
    const res = await axios.post(
      'https://chat.qwen.ai/api/v2/files/parse/status',
      {file_id_list: [fileId]},
      {headers, timeout: 30000, validateStatus: () => true},
    );
    console.log('[Overflow] files/parse/status response:', JSON.stringify({status: res.status, data: res.data}));
    if (res.status >= 400) {
      throw new Error(`files/parse/status failed: status=${res.status} body=${JSON.stringify(res.data || {})}`);
    }
    const list = Array.isArray(res.data?.data) ? res.data.data : [];
    const item = list.find((x: any) => x?.file_id === fileId) || list[0];
    const status = String(item?.status || '').toLowerCase();
    if (status === 'success' || status === 'parsed' || status === 'done') return;
    if (i < maxAttempts) await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  throw new Error(`Timed out waiting for files/parse/status success for file ${fileId}`);
}

export function putOssObjectWithSts(
  stsData: any,
  body: Buffer,
): Promise<{status: number; body: string; requestHeaders: Record<string, string>}> {
  const accessKeyId = String(stsData.access_key_id || '');
  const accessKeySecret = String(stsData.access_key_secret || '');
  const securityToken = String(stsData.security_token || '');
  const bucket = String(stsData.bucketname || '');
  const endpoint = String(stsData.endpoint || '').replace(/^https?:\/\//, '');
  const filePath = String(stsData.file_path || '');
  const region = String(stsData.region || 'oss-ap-southeast-1').replace(/^oss-/, '');
  if (!accessKeyId || !accessKeySecret || !securityToken || !bucket || !endpoint || !filePath) {
    throw new Error('OSS STS upload missing credentials or object metadata');
  }

  const now = new Date();
  const date = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const shortDate = date.slice(0, 8);
  const host = `${bucket}.${endpoint}`;
  const objectPath = `/${filePath.split('/').map(encodeURIComponent).join('/')}`;
  const canonicalUri = `/${bucket}${objectPath}`;
  const payloadHash = 'UNSIGNED-PAYLOAD';
  const scope = `${shortDate}/${region}/oss/aliyun_v4_request`;
  const contentType = 'text/plain';
  const ossUserAgent = 'aliyun-sdk-js/6.23.0 Chrome 148.0.0.0 on Linux 64-bit';
  const canonicalHeaders =
    `content-type:${contentType}\n` +
    `x-oss-content-sha256:${payloadHash}\n` +
    `x-oss-date:${date}\n` +
    `x-oss-security-token:${securityToken}\n` +
    `x-oss-user-agent:${ossUserAgent}\n`;
  const canonicalRequest = [
    'PUT',
    canonicalUri,
    '',
    canonicalHeaders,
    '',
    payloadHash,
  ].join('\n');
  const stringToSign = [
    'OSS4-HMAC-SHA256',
    date,
    scope,
    crypto.createHash('sha256').update(canonicalRequest).digest('hex'),
  ].join('\n');
  const hmac = (key: crypto.BinaryLike, value: string) =>
    crypto.createHmac('sha256', key).update(value).digest();
  const kDate = hmac(`aliyun_v4${accessKeySecret}`, shortDate);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, 'oss');
  const kSigning = hmac(kService, 'aliyun_v4_request');
  const signature = crypto
    .createHmac('sha256', kSigning)
    .update(stringToSign)
    .digest('hex');
  const requestHeaders = {
    'Content-Length': String(body.length),
    'Content-Type': contentType,
    Host: host,
    Authorization:
      `OSS4-HMAC-SHA256 Credential=${accessKeyId}/${scope},` +
      `Signature=${signature}`,
    Origin: 'https://chat.qwen.ai',
    Referer: 'https://chat.qwen.ai/',
    'x-oss-user-agent': ossUserAgent,
    'x-oss-content-sha256': payloadHash,
    'x-oss-date': date,
    'x-oss-security-token': securityToken,
  };

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: host,
        path: objectPath,
        protocol: 'https:',
        method: 'PUT',
        headers: requestHeaders,
        timeout: 30000,
      },
      res => {
        const chunks: Buffer[] = [];
        res.on('data', chunk => chunks.push(Buffer.from(chunk)));
        res.on('end', () => {
          resolve({
            status: res.statusCode || 0,
            body: Buffer.concat(chunks).toString('utf8'),
            requestHeaders,
          });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('OSS upload timeout')));
    req.on('error', reject);
    req.end(body);
  });
}

export async function uploadOverflowFileToQwen(
  fileName: string,
  content: string,
  token: string,
  cookies: string,
): Promise<{fileId: string; fileUrl: string}> {
  const headers: Record<string, string> = {
    ...buildQwenAiHeaders(token, cookies),
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Content-Type': 'application/json',
    Referer: 'https://chat.qwen.ai/',
    'User-Agent':
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    'bx-umidtoken':
      'T2gARe39mjqVjr8uNQWFkOTRhyLB03USgtOV6TNBWw2e1ELBA9f72Fe7JJMdbh84Mb0=',
    'sec-ch-ua': '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Linux"',
  };

  const size = Buffer.byteLength(content, 'utf8');
  const stsPayload = {
    filename: fileName,
    filesize: size,
    filetype: 'file',
  };
  console.log('[Overflow] getstsToken request:', JSON.stringify(stsPayload));
  const sts = await axios.post(
    'https://chat.qwen.ai/api/v2/files/getstsToken',
    stsPayload,
    {headers, timeout: 30000, validateStatus: () => true},
  );
  console.log(
    '[Overflow] getstsToken response:',
    JSON.stringify({status: sts.status, data: sts.data}),
  );
  if (sts.status !== 200 || sts?.data?.success === false) {
    throw new Error(`getstsToken failed: status=${sts.status} body=${JSON.stringify(sts.data || {})}`);
  }
  const data = sts?.data?.data || {};
  const fileUrl = String(data.file_url || data.url || '');
  const fileId = String(data.file_id || data.id || '');
  if (!fileUrl || !fileId) throw new Error('getstsToken missing file_url/file_id');

  const upload = await putOssObjectWithSts(
    data,
    Buffer.from(content, 'utf8'),
  );
  console.log(
    '[Overflow] OSS upload response:',
    JSON.stringify({
      status: upload.status,
      headers: upload.requestHeaders,
      data: upload.body.slice(0, 2000),
    }),
  );
  if (upload.status < 200 || upload.status >= 300) {
    throw new Error(`OSS upload failed: status=${upload.status} body=${upload.body.slice(0, 2000)}`);
  }

  const parsed = await axios.post(
    'https://chat.qwen.ai/api/v2/files/parse',
    {file_id: fileId},
    {headers, timeout: 30000, validateStatus: () => true},
  );
  console.log('[Overflow] files/parse response:', JSON.stringify({status: parsed.status, data: parsed.data}));
  if (parsed.status !== 200 || parsed?.data?.success === false) {
    throw new Error(`files/parse failed: status=${parsed.status} body=${JSON.stringify(parsed.data || {})}`);
  }

  await waitForFileParseStatus(fileId, headers);

  return {fileId, fileUrl};
}
