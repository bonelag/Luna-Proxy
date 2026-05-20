/**
 * Upstream Error Handler
 *
 * Detects, normalizes, and classifies errors returned by Qwen upstream.
 * Inspired by the error handling patterns in Qwen2API_Go (internal/qwen/upstream.go).
 *
 * Error categories:
 * - RateLimited / quota exceeded → 429
 * - Human verification (captcha) → 429 with specific message
 * - Token limit exceeded → 429
 * - Internal / bad request → 502
 * - Auth failures → 401
 */

export interface UpstreamError {
  /** HTTP status code to return to the client */
  statusCode: number;
  /** Error type identifier for logging */
  errorType: 'rate_limit' | 'quota_exceeded' | 'token_limit' | 'human_verification' | 'auth_failure' | 'internal_error' | 'unknown';
  /** Human-readable error message */
  message: string;
  /** Whether the error is retryable (e.g. with a different account) */
  retryable: boolean;
  /** Original error content for debugging */
  rawError?: string;
}

/** Patterns that indicate rate limiting */
const RATE_LIMIT_PATTERNS = [
  'ratelimited',
  'rate_limited',
  'rate limit',
  'too many requests',
  'request_rate_limit',
  'throttled',
  'throttling',
];

/** Patterns that indicate quota/token limit exceeded */
const QUOTA_PATTERNS = [
  'allocated quota exceeded',
  'quota exceeded',
  'token-limit',
  'token_limit',
  'tokens exceeded',
  'context length exceeded',
  'context_length_exceeded',
  'maximum context length',
  'max_tokens',
  'prompt is too long',
  'input too long',
];

/** Patterns that indicate human verification / captcha */
const CAPTCHA_PATTERNS = [
  '验证码',
  '人机验证',
  'captcha',
  'human verification',
  'verify you are human',
  'challenge required',
  'slider verification',
  'security check',
];

/** Patterns that indicate auth failures */
const AUTH_PATTERNS = [
  'unauthorized',
  'invalid token',
  'token expired',
  'invalid_token',
  'authentication failed',
  'login required',
  'session expired',
  'invalid credentials',
];

/**
 * Normalize an upstream error from Qwen into a structured UpstreamError.
 *
 * Inspects both HTTP status codes and response body text to classify the error.
 */
export function normalizeUpstreamError(
  httpStatus: number | undefined,
  responseBody: string | Record<string, any> | undefined,
  errorMessage?: string,
): UpstreamError | null {
  const bodyText = typeof responseBody === 'string'
    ? responseBody
    : responseBody ? JSON.stringify(responseBody) : '';
  const combined = `${bodyText} ${errorMessage || ''}`.toLowerCase();

  if (!combined.trim() && (!httpStatus || httpStatus < 400)) {
    return null;
  }

  // Check for rate limiting
  if (httpStatus === 429 || matchesAny(combined, RATE_LIMIT_PATTERNS)) {
    return {
      statusCode: 429,
      errorType: 'rate_limit',
      message: 'Qwen upstream rate limit reached. Please wait before retrying.',
      retryable: true,
      rawError: bodyText.slice(0, 500),
    };
  }

  // Check for quota / token limit
  if (matchesAny(combined, QUOTA_PATTERNS)) {
    return {
      statusCode: 429,
      errorType: 'quota_exceeded',
      message: 'Qwen upstream quota or token limit exceeded. Try reducing prompt size or wait for quota reset.',
      retryable: true,
      rawError: bodyText.slice(0, 500),
    };
  }

  // Check for human verification (captcha)
  if (matchesAny(combined, CAPTCHA_PATTERNS)) {
    return {
      statusCode: 429,
      errorType: 'human_verification',
      message: 'Qwen upstream requires human verification (captcha). Please log in to Qwen web and complete verification, then retry.',
      retryable: false,
      rawError: bodyText.slice(0, 500),
    };
  }

  // Check for auth failures
  if (httpStatus === 401 || httpStatus === 403 || matchesAny(combined, AUTH_PATTERNS)) {
    return {
      statusCode: 401,
      errorType: 'auth_failure',
      message: 'Qwen authentication failed. Token may be expired or invalid. Please refresh credentials.',
      retryable: false,
      rawError: bodyText.slice(0, 500),
    };
  }

  // Check for Qwen success:false in JSON response
  if (typeof responseBody === 'object' && responseBody !== null) {
    const success = (responseBody as any).success;
    const errorCode = String((responseBody as any).errorCode || (responseBody as any).error_code || '');
    const errorMsg = String((responseBody as any).errorMsg || (responseBody as any).error_msg || (responseBody as any).message || '');

    if (success === false) {
      // Check specific error codes
      if (errorCode === 'RateLimited' || errorCode === 'rate_limited') {
        return {
          statusCode: 429,
          errorType: 'rate_limit',
          message: `Qwen upstream rate limited: ${errorMsg}`,
          retryable: true,
          rawError: bodyText.slice(0, 500),
        };
      }

      return {
        statusCode: 502,
        errorType: 'internal_error',
        message: `Qwen upstream error: ${errorMsg || 'unknown error'}`,
        retryable: true,
        rawError: bodyText.slice(0, 500),
      };
    }
  }

  // Generic server errors
  if (httpStatus && httpStatus >= 500) {
    return {
      statusCode: 502,
      errorType: 'internal_error',
      message: 'Qwen upstream internal error. The request may be retried.',
      retryable: true,
      rawError: bodyText.slice(0, 500),
    };
  }

  if (httpStatus && httpStatus >= 400) {
    return {
      statusCode: httpStatus,
      errorType: 'unknown',
      message: `Qwen upstream error (HTTP ${httpStatus})`,
      retryable: false,
      rawError: bodyText.slice(0, 500),
    };
  }

  return null;
}

/**
 * Inspect early SSE stream data for upstream errors.
 *
 * Qwen sometimes embeds error payloads inside the SSE stream itself
 * (e.g. `data: {"success": false, "errorCode": "RateLimited", ...}`).
 * This function checks a buffer of initial stream content for such patterns.
 */
export function inspectStreamForError(streamBuffer: string): UpstreamError | null {
  if (!streamBuffer || streamBuffer.length === 0) return null;

  const lower = streamBuffer.toLowerCase();

  // Check for rate limit / quota patterns in stream
  if (matchesAny(lower, RATE_LIMIT_PATTERNS)) {
    return normalizeUpstreamError(429, streamBuffer);
  }
  if (matchesAny(lower, QUOTA_PATTERNS)) {
    return normalizeUpstreamError(429, streamBuffer);
  }
  if (matchesAny(lower, CAPTCHA_PATTERNS)) {
    return normalizeUpstreamError(undefined, streamBuffer);
  }

  // Try to parse SSE data lines for JSON error payloads
  const dataLines = streamBuffer.split('\n')
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trim());

  for (const dataLine of dataLines) {
    if (!dataLine || dataLine === '[DONE]') continue;
    try {
      const parsed = JSON.parse(dataLine);
      if (parsed.success === false || parsed.error || parsed.errorCode) {
        const error = normalizeUpstreamError(undefined, parsed);
        if (error) return error;
      }
    } catch {
      // Not JSON, skip
    }
  }

  return null;
}

/**
 * Check if an error is retryable (can be retried with a different account).
 */
export function isRetryableError(error: UpstreamError | null): boolean {
  return error?.retryable ?? false;
}

/**
 * Check if an error is a rate limit error (429-class).
 */
export function isRateLimitError(error: UpstreamError | null): boolean {
  if (!error) return false;
  return error.errorType === 'rate_limit'
    || error.errorType === 'quota_exceeded'
    || error.errorType === 'token_limit';
}

/**
 * Format an UpstreamError for client-facing JSON response.
 */
export function formatUpstreamErrorResponse(error: UpstreamError): Record<string, any> {
  return {
    error: {
      message: error.message,
      type: error.errorType,
      code: error.statusCode,
      retryable: error.retryable,
    },
  };
}

function matchesAny(text: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (text.includes(pattern)) return true;
  }
  return false;
}
