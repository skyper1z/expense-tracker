/**
 * SpendNote's own email sign-in codes, delivered through a free email API.
 *
 *   send:   make a random 6-digit code → store only a keyed hash (HMAC-SHA256) → email the code
 *   verify: hash what the user typed → compare in Postgres (expiry, 5 tries, single use)
 *
 * Email delivery is pluggable: Brevo (300 emails/day free, just verify a sender address) or
 * Resend (3,000/month free, needs your own domain to email anyone but yourself).
 *
 * No Deno-specific APIs here, so this file also runs under Vitest.
 */

export const CODE_TTL_SECONDS = 600;
export const MAX_ATTEMPTS = 5;

export type SendResult = { ok: true } | { ok: false; status: number; retryAfter?: number };

export type VerifyResult =
  | { status: 'valid' }
  | { status: 'invalid' }
  | { status: 'expired' }
  | { status: 'locked' }
  | { status: 'error'; httpStatus: number };

/** What the sign-in handlers need from a code provider. */
export interface OtpProvider {
  sendCode(email: string): Promise<SendResult>;
  verifyCode(email: string, code: string): Promise<VerifyResult>;
}

export type CheckOutcome = 'valid' | 'invalid' | 'expired' | 'missing' | 'locked';

/** Where code hashes live (Postgres functions otp_store_code / otp_check_code). */
export interface CodeStore {
  save(email: string, codeHash: string, ttlSeconds: number): Promise<void>;
  check(email: string, codeHash: string, maxAttempts: number): Promise<CheckOutcome>;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailSender {
  readonly name: string;
  send(message: EmailMessage): Promise<SendResult>;
}

export interface Sender {
  email: string;
  name: string;
}

/** A uniformly random 6-digit code (rejection sampling, so no digit pattern is more likely). */
export function generateCode(fill: (a: Uint32Array) => void = (a) => crypto.getRandomValues(a)): string {
  const limit = Math.floor(0x1_0000_0000 / 1_000_000) * 1_000_000;
  const buf = new Uint32Array(1);
  do fill(buf);
  while (buf[0] >= limit);
  return String(buf[0] % 1_000_000).padStart(6, '0');
}

/** Keyed hash, so a leaked table can't be brute-forced without the server secret. */
export async function hashCode(email: string, code: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${email}:${code}`));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** "SpendNote <hello@example.com>" or "hello@example.com" → { name, email } */
export function parseFrom(value: string): Sender | null {
  const v = value.trim();
  const m = /^(.*)<\s*([^<>\s]+@[^<>\s]+\.[^<>\s]+)\s*>$/.exec(v);
  if (m) return { name: m[1].trim().replace(/^"|"$/g, '') || 'SpendNote', email: m[2] };
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v) ? { name: 'SpendNote', email: v } : null;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function renderCodeEmail(code: string, minutes: number): Omit<EmailMessage, 'to'> {
  const subject = `${code} is your SpendNote sign-in code`;
  const text = [
    `Your SpendNote sign-in code is: ${code}`,
    '',
    `It expires in ${minutes} minutes and can be used once.`,
    'If you didn’t try to sign in, you can ignore this email. Nobody can get in without this code.',
    '',
    'SpendNote by O.B (Osei-Bonsu)',
  ].join('\n');
  const safe = escapeHtml(code);
  const html = `<!doctype html>
<html lang="en"><body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#18181b">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:440px;background:#ffffff;border-radius:20px;overflow:hidden">
<tr><td style="height:6px;background:#ff6a1a"></td></tr>
<tr><td style="padding:32px 32px 8px">
<p style="margin:0;font-size:18px;font-weight:700">SpendNote</p>
<p style="margin:20px 0 8px;font-size:16px;line-height:1.5">Your sign-in code is:</p>
<p style="margin:0;font-size:36px;font-weight:700;letter-spacing:8px;font-family:'SF Mono',Menlo,Consolas,monospace">${safe}</p>
<p style="margin:20px 0 0;font-size:14px;line-height:1.6;color:#52525b">It expires in ${minutes} minutes and can be used once. If you didn’t try to sign in, you can ignore this email. Nobody can get in without this code.</p>
</td></tr>
<tr><td style="padding:24px 32px 28px;font-size:12px;color:#a1a1aa">SpendNote by O.B (Osei-Bonsu)</td></tr>
</table></td></tr></table></body></html>`;
  return { subject, text, html };
}

function retryAfterSeconds(res: Response): number | undefined {
  const v = res.headers.get('retry-after');
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.max(0, Math.ceil(n)) : undefined;
}

async function post(doFetch: typeof fetch, url: string, headers: Record<string, string>, body: unknown): Promise<SendResult> {
  let res: Response;
  try {
    res = await doFetch(url, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return { ok: false, status: 0 };
  }
  await res.body?.cancel().catch(() => undefined);
  return res.ok ? { ok: true } : { ok: false, status: res.status, retryAfter: retryAfterSeconds(res) };
}

/** Brevo transactional email API: https://developers.brevo.com/reference/sendtransacemail */
export function createBrevoSender(cfg: { apiKey: string; from: Sender; fetch?: typeof fetch }): EmailSender {
  return {
    name: 'brevo',
    send: (m) =>
      post(cfg.fetch ?? fetch, 'https://api.brevo.com/v3/smtp/email', { 'api-key': cfg.apiKey }, {
        sender: { email: cfg.from.email, name: cfg.from.name },
        to: [{ email: m.to }],
        subject: m.subject,
        htmlContent: m.html,
        textContent: m.text,
      }),
  };
}

/** Resend email API: https://resend.com/docs/api-reference/emails/send-email */
export function createResendSender(cfg: { apiKey: string; from: Sender; fetch?: typeof fetch }): EmailSender {
  return {
    name: 'resend',
    send: (m) =>
      post(cfg.fetch ?? fetch, 'https://api.resend.com/emails', { Authorization: `Bearer ${cfg.apiKey}` }, {
        from: `${cfg.from.name} <${cfg.from.email}>`,
        to: [m.to],
        subject: m.subject,
        html: m.html,
        text: m.text,
      }),
  };
}

export function createEmailOtpProvider(cfg: {
  store: CodeStore;
  sender: EmailSender;
  secret: string;
  ttlSeconds?: number;
  maxAttempts?: number;
  makeCode?: () => string;
}): OtpProvider {
  const ttl = cfg.ttlSeconds ?? CODE_TTL_SECONDS;
  const max = cfg.maxAttempts ?? MAX_ATTEMPTS;
  const makeCode = cfg.makeCode ?? (() => generateCode());
  return {
    async sendCode(email) {
      const code = makeCode();
      await cfg.store.save(email, await hashCode(email, code, cfg.secret), ttl);
      return cfg.sender.send({ to: email, ...renderCodeEmail(code, Math.round(ttl / 60)) });
    },
    async verifyCode(email, code) {
      const outcome = await cfg.store.check(email, await hashCode(email, code, cfg.secret), max);
      if (outcome === 'valid') return { status: 'valid' };
      if (outcome === 'expired') return { status: 'expired' };
      if (outcome === 'locked') return { status: 'locked' };
      return { status: 'invalid' }; // wrong code, or no code requested for this email
    },
  };
}
