/**
 * Minimal Authentica client for email OTP, using the documented REST API:
 *   POST {base}/send-otp    { method: "email", email, template_id? }  → { success: true, ... }
 *   POST {base}/verify-otp  { email, otp }                            → { status: true, ... }
 * Authenticated with the `X-Authorization: <API key>` header.
 * Docs: https://docs.authentica.sa (the official SDK needs Node 22, so we call the API with fetch).
 *
 * No Deno-specific APIs here, so this file also runs under Vitest.
 */

export const AUTHENTICA_BASE_URL = 'https://api.authentica.sa/api/v2';

export type SendResult =
  | { ok: true }
  | { ok: false; status: number; retryAfter?: number };

export type VerifyResult =
  | { status: 'valid' }
  | { status: 'invalid' }
  | { status: 'rate_limited'; retryAfter?: number }
  | { status: 'error'; httpStatus: number };

export interface AuthenticaClient {
  sendEmailOtp(email: string): Promise<SendResult>;
  verifyEmailOtp(email: string, otp: string): Promise<VerifyResult>;
}

export interface AuthenticaConfig {
  apiKey: string;
  baseUrl?: string;
  /** Email template configured in the Authentica dashboard. Omit to use the account default. */
  emailTemplateId?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

function retryAfterSeconds(res: Response): number | undefined {
  const v = res.headers.get('retry-after');
  if (!v) return undefined;
  const n = Number(v);
  if (Number.isFinite(n)) return Math.max(0, Math.ceil(n));
  const at = Date.parse(v);
  return Number.isNaN(at) ? undefined : Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    const body = await res.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function createAuthenticaClient(config: AuthenticaConfig): AuthenticaClient {
  const base = (config.baseUrl ?? AUTHENTICA_BASE_URL).replace(/\/+$/, '');
  const doFetch = config.fetch ?? fetch;
  const timeoutMs = config.timeoutMs ?? 10_000;
  const headers = {
    'X-Authorization': config.apiKey,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };

  const post = (path: string, body: unknown) =>
    doFetch(`${base}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });

  return {
    async sendEmailOtp(email) {
      const body: Record<string, unknown> = { method: 'email', email };
      if (config.emailTemplateId !== undefined) body.template_id = config.emailTemplateId;
      let res: Response;
      try {
        res = await post('/send-otp', body);
      } catch {
        return { ok: false, status: 0 };
      }
      const json = await readJson(res);
      if (res.ok && json?.success === true) return { ok: true };
      return { ok: false, status: res.status, retryAfter: retryAfterSeconds(res) };
    },

    async verifyEmailOtp(email, otp) {
      let res: Response;
      try {
        // Sent as a string so codes with leading zeros survive.
        res = await post('/verify-otp', { email, otp: String(otp) });
      } catch {
        return { status: 'error', httpStatus: 0 };
      }
      const json = await readJson(res);
      if (res.ok && json?.status === true) return { status: 'valid' };
      // A wrong or expired code comes back as status:false, or as HTTP 422.
      if ((res.ok && json?.status === false) || res.status === 422 || res.status === 400) return { status: 'invalid' };
      if (res.status === 429) return { status: 'rate_limited', retryAfter: retryAfterSeconds(res) };
      return { status: 'error', httpStatus: res.status };
    },
  };
}
