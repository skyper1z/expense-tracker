/**
 * Request handlers for SpendNote's email-OTP sign-in.
 *
 *   auth-send-otp    { email }        → Authentica emails a one-time code
 *   auth-verify-otp  { email, code }  → Authentica checks it; if valid we return a Supabase session
 *
 * Everything external (Authentica, rate limits in Postgres, session creation) is passed in,
 * so these handlers have no Deno-specific code and are unit-tested with Vitest.
 */
import type { AuthenticaClient } from './authentica.ts';

export interface Gate {
  allowed: boolean;
  retryAfter: number;
  reason?: string;
}

export interface RateLimiter {
  registerSend(email: string, ip: string | null): Promise<Gate>;
  verifyAllowed(email: string, ip: string | null): Promise<Gate>;
  registerVerifyFailure(email: string, ip: string | null): Promise<void>;
  clearFailures(email: string): Promise<void>;
}

export interface IssuedSession {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at?: number;
  token_type: string;
  user: { id: string; email: string };
}

export interface SessionIssuer {
  /** Creates the user if needed and returns a signed-in session for this (already verified) email. */
  issueForEmail(email: string): Promise<IssuedSession>;
}

export interface OtpDeps {
  authentica: AuthenticaClient;
  limits: RateLimiter;
  sessions: SessionIssuer;
  /** Allowed browser origins for CORS. Empty means any origin. */
  allowedOrigins: string[];
  /** Set when required secrets are missing, so requests fail clearly instead of crashing. */
  configError?: string;
  log?: (message: string, extra?: Record<string, unknown>) => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && EMAIL_RE.test(email) ? email : null;
}

/** Authentica doesn't document a fixed code length, so accept 4–10 letters or digits. */
export function normalizeCode(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const code = String(value).replace(/[\s-]+/g, '');
  return /^[0-9A-Za-z]{4,10}$/.test(code) ? code : null;
}

export function clientIp(req: Request): string | null {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim() || null;
  return req.headers.get('x-real-ip') ?? req.headers.get('cf-connecting-ip');
}

export function corsHeaders(req: Request, allowedOrigins: string[]): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const allow = allowedOrigins.length === 0 ? '*' : allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

function waitText(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, seconds)} seconds`;
  const minutes = Math.ceil(seconds / 60);
  return minutes === 1 ? '1 minute' : `${minutes} minutes`;
}

function json(status: number, body: unknown, cors: Record<string, string>, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra },
  });
}

async function readBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Shared preamble: CORS, method and configuration checks. Returns a response to send, or null to continue. */
function guard(req: Request, deps: OtpDeps, cors: Record<string, string>): Response | null {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed', message: 'Use POST.' }, cors);
  if (deps.configError) {
    deps.log?.('sign-in is not configured', { detail: deps.configError });
    return json(500, { error: 'not_configured', message: 'Sign-in isn’t set up on the server yet.' }, cors);
  }
  return null;
}

export async function handleSendOtp(req: Request, deps: OtpDeps): Promise<Response> {
  const cors = corsHeaders(req, deps.allowedOrigins);
  const early = guard(req, deps, cors);
  if (early) return early;
  try {
    const body = await readBody(req);
    const email = normalizeEmail(body?.email);
    if (!email) return json(400, { error: 'invalid_email', message: 'Enter a valid email address.' }, cors);

    const ip = clientIp(req);
    const gate = await deps.limits.registerSend(email, ip);
    if (!gate.allowed) {
      const message =
        gate.reason === 'cooldown'
          ? `A code was just sent. You can ask for another in ${waitText(gate.retryAfter)}.`
          : `Too many codes requested. Try again in ${waitText(gate.retryAfter)}.`;
      return json(429, { error: gate.reason ?? 'rate_limited', message, retryAfter: gate.retryAfter }, cors, {
        'Retry-After': String(gate.retryAfter),
      });
    }

    const sent = await deps.authentica.sendEmailOtp(email);
    if (!sent.ok) {
      deps.log?.('Authentica send-otp failed', { status: sent.status });
      if (sent.status === 429) {
        const wait = sent.retryAfter ?? 60;
        return json(429, { error: 'rate_limited', message: `Too many codes requested. Try again in ${waitText(wait)}.`, retryAfter: wait }, cors, {
          'Retry-After': String(wait),
        });
      }
      return json(502, { error: 'send_failed', message: 'We couldn’t send the code right now. Try again in a moment.' }, cors);
    }
    return json(200, { ok: true, resendAfter: gate.retryAfter }, cors);
  } catch (err) {
    deps.log?.('auth-send-otp error', { error: String(err) });
    return json(500, { error: 'server_error', message: 'Something went wrong. Try again in a moment.' }, cors);
  }
}

export async function handleVerifyOtp(req: Request, deps: OtpDeps): Promise<Response> {
  const cors = corsHeaders(req, deps.allowedOrigins);
  const early = guard(req, deps, cors);
  if (early) return early;
  try {
    const body = await readBody(req);
    const email = normalizeEmail(body?.email);
    if (!email) return json(400, { error: 'invalid_email', message: 'Enter a valid email address.' }, cors);
    const code = normalizeCode(body?.code);
    if (!code) return json(400, { error: 'invalid_code', message: 'Enter the code from the email.' }, cors);

    const ip = clientIp(req);
    const gate = await deps.limits.verifyAllowed(email, ip);
    if (!gate.allowed) {
      return json(429, {
        error: 'too_many_attempts',
        message: `Too many wrong codes. Try again in ${waitText(gate.retryAfter)}, or request a new code then.`,
        retryAfter: gate.retryAfter,
      }, cors, { 'Retry-After': String(gate.retryAfter) });
    }

    const result = await deps.authentica.verifyEmailOtp(email, code);
    if (result.status === 'invalid') {
      await deps.limits.registerVerifyFailure(email, ip);
      return json(400, { error: 'invalid_code', message: 'That code isn’t right or has expired. Check it, or request a new one.' }, cors);
    }
    if (result.status === 'rate_limited') {
      const wait = result.retryAfter ?? 60;
      return json(429, { error: 'rate_limited', message: `Too many attempts. Try again in ${waitText(wait)}.`, retryAfter: wait }, cors, {
        'Retry-After': String(wait),
      });
    }
    if (result.status === 'error') {
      deps.log?.('Authentica verify-otp failed', { status: result.httpStatus });
      return json(502, { error: 'verify_failed', message: 'We couldn’t check the code right now. Try again in a moment.' }, cors);
    }

    let session: IssuedSession;
    try {
      session = await deps.sessions.issueForEmail(email);
    } catch (err) {
      deps.log?.('could not issue session', { error: String(err) });
      return json(500, {
        error: 'session_failed',
        message: 'Your code was right, but we couldn’t sign you in. Request a new code and try again.',
      }, cors);
    }
    await deps.limits.clearFailures(email).catch(() => undefined);
    return json(200, { session, user: session.user }, cors);
  } catch (err) {
    deps.log?.('auth-verify-otp error', { error: String(err) });
    return json(500, { error: 'server_error', message: 'Something went wrong. Try again in a moment.' }, cors);
  }
}
