import { describe, expect, it, vi } from 'vitest';
import {
  createBrevoSender, createEmailOtpProvider, createResendSender, generateCode, hashCode, parseFrom, renderCodeEmail,
  type CheckOutcome, type CodeStore, type EmailMessage, type OtpProvider,
} from './email-otp.ts';
import { handleSendOtp, handleVerifyOtp, normalizeCode, normalizeEmail, type OtpDeps } from './otp.ts';

const session = {
  access_token: 'access', refresh_token: 'refresh', expires_in: 3600, expires_at: 1, token_type: 'bearer',
  user: { id: 'user-1', email: 'ama@example.com' },
};

function deps(over: Partial<OtpDeps> = {}, provider: Partial<OtpProvider> = {}) {
  return {
    provider: {
      sendCode: vi.fn(async () => ({ ok: true as const })),
      verifyCode: vi.fn(async () => ({ status: 'valid' as const })),
      ...provider,
    },
    limits: {
      registerSend: vi.fn(async () => ({ allowed: true, retryAfter: 60 })),
      verifyAllowed: vi.fn(async () => ({ allowed: true, retryAfter: 0 })),
      registerVerifyFailure: vi.fn(async () => undefined),
      clearFailures: vi.fn(async () => undefined),
    },
    sessions: { issueForEmail: vi.fn(async () => session) },
    allowedOrigins: [],
    ...over,
  };
}

const req = (body: unknown, init: RequestInit & { ip?: string; origin?: string } = {}) =>
  new Request('https://x.supabase.co/functions/v1/fn', {
    method: init.method ?? 'POST',
    headers: {
      'content-type': 'application/json',
      ...(init.ip ? { 'x-forwarded-for': `${init.ip}, 10.0.0.1` } : {}),
      ...(init.origin ? { origin: init.origin } : {}),
    },
    body: init.method === 'OPTIONS' || init.method === 'GET' ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });

/** In-memory stand-in for the otp_store_code / otp_check_code Postgres functions. */
function memoryStore(now = () => Date.now()) {
  const rows = new Map<string, { hash: string; expires: number; attempts: number }>();
  const store: CodeStore = {
    async save(email, hash, ttl) {
      rows.set(email, { hash, expires: now() + ttl * 1000, attempts: 0 });
    },
    async check(email, hash, max): Promise<CheckOutcome> {
      const r = rows.get(email);
      if (!r) return 'missing';
      if (r.expires <= now()) {
        rows.delete(email);
        return 'expired';
      }
      if (r.attempts >= max) return 'locked';
      if (r.hash === hash) {
        rows.delete(email);
        return 'valid';
      }
      r.attempts++;
      return 'invalid';
    },
  };
  return { store, rows };
}

describe('input normalisation', () => {
  it('normalises emails and rejects bad ones', () => {
    expect(normalizeEmail('  Ama@Example.COM ')).toBe('ama@example.com');
    expect(normalizeEmail('not-an-email')).toBeNull();
    expect(normalizeEmail(42)).toBeNull();
    expect(normalizeEmail(`${'a'.repeat(250)}@x.com`)).toBeNull();
  });
  it('accepts codes ignoring spaces, rejects junk', () => {
    expect(normalizeCode('123 456')).toBe('123456');
    expect(normalizeCode('012345')).toBe('012345');
    expect(normalizeCode('12')).toBeNull();
    expect(normalizeCode('12<45')).toBeNull();
  });
});

describe('auth-send-otp', () => {
  it('sends a code for a valid email', async () => {
    const d = deps();
    const res = await handleSendOtp(req({ email: ' Ama@Example.com ' }, { ip: '1.2.3.4' }), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, resendAfter: 60 });
    expect(d.limits.registerSend).toHaveBeenCalledWith('ama@example.com', '1.2.3.4');
    expect(d.provider.sendCode).toHaveBeenCalledWith('ama@example.com');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('rejects invalid emails without sending anything', async () => {
    const d = deps();
    const res = await handleSendOtp(req({ email: 'nope' }), d);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_email');
    expect(d.provider.sendCode).not.toHaveBeenCalled();
    expect((await handleSendOtp(req('{bad json'), d)).status).toBe(400);
  });

  it('enforces the resend cooldown without sending', async () => {
    const d = deps();
    d.limits.registerSend.mockResolvedValueOnce({ allowed: false, retryAfter: 42, reason: 'cooldown' } as never);
    const res = await handleSendOtp(req({ email: 'ama@example.com' }), d);
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('42');
    expect((await res.json()).message).toMatch(/another in 42 seconds/);
    expect(d.provider.sendCode).not.toHaveBeenCalled();
  });

  it('reports email delivery failures without leaking details', async () => {
    const d = deps({}, { sendCode: vi.fn(async () => ({ ok: false as const, status: 401 })) });
    const res = await handleSendOtp(req({ email: 'ama@example.com' }), d);
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toMatch(/401|key/i);
  });

  it('handles CORS preflight, wrong methods and missing configuration', async () => {
    const d = deps({ allowedOrigins: ['https://spendnote.app'] });
    const pre = await handleSendOtp(req(null, { method: 'OPTIONS', origin: 'https://spendnote.app' }), d);
    expect(pre.status).toBe(200);
    expect(pre.headers.get('access-control-allow-origin')).toBe('https://spendnote.app');
    expect(pre.headers.get('access-control-allow-headers')).toMatch(/apikey/);
    expect((await handleSendOtp(req(null, { method: 'GET' }), d)).status).toBe(405);
    const off = await handleSendOtp(req({ email: 'ama@example.com' }), deps({ configError: 'Missing secrets: BREVO_API_KEY or RESEND_API_KEY' }));
    expect(off.status).toBe(500);
    expect((await off.json()).error).toBe('not_configured');
  });
});

describe('auth-verify-otp', () => {
  it('returns a session for the right code', async () => {
    const d = deps();
    const res = await handleVerifyOtp(req({ email: 'Ama@example.com', code: '012 345' }, { ip: '1.2.3.4' }), d);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session.access_token).toBe('access');
    expect(body.user).toEqual({ id: 'user-1', email: 'ama@example.com' });
    expect(d.provider.verifyCode).toHaveBeenCalledWith('ama@example.com', '012345');
    expect(d.sessions.issueForEmail).toHaveBeenCalledWith('ama@example.com');
    expect(d.limits.clearFailures).toHaveBeenCalledWith('ama@example.com');
  });

  it('rejects a wrong code, records the attempt and issues no session', async () => {
    const d = deps({}, { verifyCode: vi.fn(async () => ({ status: 'invalid' as const })) });
    const res = await handleVerifyOtp(req({ email: 'ama@example.com', code: '999999' }, { ip: '1.2.3.4' }), d);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_code');
    expect(d.limits.registerVerifyFailure).toHaveBeenCalledWith('ama@example.com', '1.2.3.4');
    expect(d.sessions.issueForEmail).not.toHaveBeenCalled();
  });

  it('explains expired and locked codes', async () => {
    const expired = await handleVerifyOtp(req({ email: 'a@b.co', code: '123456' }), deps({}, { verifyCode: vi.fn(async () => ({ status: 'expired' as const })) }));
    expect(expired.status).toBe(400);
    expect((await expired.json()).message).toMatch(/expired/);
    const locked = await handleVerifyOtp(req({ email: 'a@b.co', code: '123456' }), deps({}, { verifyCode: vi.fn(async () => ({ status: 'locked' as const })) }));
    expect(locked.status).toBe(429);
    expect((await locked.json()).message).toMatch(/Request a new code/);
  });

  it('stops checking codes after too many wrong attempts', async () => {
    const d = deps();
    d.limits.verifyAllowed.mockResolvedValueOnce({ allowed: false, retryAfter: 600, reason: 'too_many_attempts' } as never);
    const res = await handleVerifyOtp(req({ email: 'ama@example.com', code: '123456' }), d);
    expect(res.status).toBe(429);
    expect((await res.json()).message).toMatch(/10 minutes/);
    expect(d.provider.verifyCode).not.toHaveBeenCalled();
  });

  it('validates input and handles session errors', async () => {
    expect((await handleVerifyOtp(req({ email: 'ama@example.com', code: '1' }), deps())).status).toBe(400);
    const noSession = deps();
    noSession.sessions.issueForEmail.mockRejectedValueOnce(new Error('boom'));
    const res = await handleVerifyOtp(req({ email: 'ama@example.com', code: '123456' }), noSession);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('session_failed');
  });
});

describe('codes', () => {
  it('are 6 digits, keep leading zeros, and are spread evenly', () => {
    let n = 0;
    const seq = [5, 0xffffffff, 1_000_123]; // the 2nd is above the cut-off and must be re-drawn
    expect(generateCode((a) => (a[0] = seq[n++ % seq.length]))).toBe('000005');
    expect(generateCode((a) => (a[0] = seq[n++ % seq.length]))).toBe('000123');
    const seen = new Set(Array.from({ length: 2000 }, () => generateCode()));
    expect([...seen].every((c) => /^\d{6}$/.test(c))).toBe(true);
    expect(seen.size).toBeGreaterThan(1990);
  });

  it('are stored only as a keyed hash tied to the email', async () => {
    const h = await hashCode('ama@example.com', '123456', 'secret');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).not.toContain('123456');
    expect(await hashCode('ama@example.com', '123456', 'secret')).toBe(h);
    expect(await hashCode('kofi@example.com', '123456', 'secret')).not.toBe(h);
    expect(await hashCode('ama@example.com', '123456', 'other-secret')).not.toBe(h);
  });
});

describe('email code provider', () => {
  const setup = (over: { send?: (m: EmailMessage) => Promise<{ ok: true } | { ok: false; status: number }> } = {}) => {
    const sent: EmailMessage[] = [];
    let clock = Date.parse('2026-11-20T10:00:00Z');
    const { store, rows } = memoryStore(() => clock);
    const provider = createEmailOtpProvider({
      store,
      secret: 'test-secret',
      sender: { name: 'test', send: over.send ?? (async (m) => (sent.push(m), { ok: true as const })) },
    });
    return { provider, sent, rows, tick: (ms: number) => (clock += ms) };
  };
  const codeIn = (m: EmailMessage) => /(\d{6}) is your SpendNote sign-in code/.exec(m.subject)![1];

  it('emails a code and accepts it once', async () => {
    const { provider, sent, rows } = setup();
    expect(await provider.sendCode('ama@example.com')).toEqual({ ok: true });
    expect(sent[0].to).toBe('ama@example.com');
    const code = codeIn(sent[0]);
    expect(sent[0].text).toContain(code);
    expect(JSON.stringify([...rows.values()])).not.toContain(code); // only the hash is stored
    expect(await provider.verifyCode('ama@example.com', code)).toEqual({ status: 'valid' });
    expect(await provider.verifyCode('ama@example.com', code)).toEqual({ status: 'invalid' }); // single use
  });

  it('only the latest code works', async () => {
    const { provider, sent } = setup();
    await provider.sendCode('ama@example.com');
    await provider.sendCode('ama@example.com');
    const [first, second] = sent.map(codeIn);
    if (first !== second) expect(await provider.verifyCode('ama@example.com', first)).toEqual({ status: 'invalid' });
    expect(await provider.verifyCode('ama@example.com', second)).toEqual({ status: 'valid' });
  });

  it('locks after 5 wrong tries, and codes expire after 10 minutes', async () => {
    const { provider, sent, tick } = setup();
    await provider.sendCode('ama@example.com');
    const code = codeIn(sent[0]);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) expect(await provider.verifyCode('ama@example.com', wrong)).toEqual({ status: 'invalid' });
    expect(await provider.verifyCode('ama@example.com', code)).toEqual({ status: 'locked' });

    await provider.sendCode('kofi@example.com');
    tick(10 * 60 * 1000 + 1);
    expect(await provider.verifyCode('kofi@example.com', codeIn(sent[1]))).toEqual({ status: 'expired' });
  });

  it('reports delivery failures', async () => {
    const { provider } = setup({ send: async () => ({ ok: false, status: 401 }) });
    expect(await provider.sendCode('ama@example.com')).toEqual({ ok: false, status: 401 });
  });
});

describe('email senders', () => {
  const reply = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const msg: EmailMessage = { to: 'ama@example.com', subject: 'S', text: 'T', html: '<p>H</p>' };
  const from = { name: 'SpendNote', email: 'hello@example.com' };

  it('sends the documented Brevo request', async () => {
    const f = vi.fn(async () => reply(201, { messageId: 'x' }));
    expect(await createBrevoSender({ apiKey: 'brevo-key', from, fetch: f as never }).send(msg)).toEqual({ ok: true });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect((init.headers as Record<string, string>)['api-key']).toBe('brevo-key');
    expect(JSON.parse(init.body as string)).toEqual({
      sender: from, to: [{ email: 'ama@example.com' }], subject: 'S', htmlContent: '<p>H</p>', textContent: 'T',
    });
  });

  it('sends the documented Resend request', async () => {
    const f = vi.fn(async () => reply(200, { id: 'x' }));
    expect(await createResendSender({ apiKey: 're_key', from, fetch: f as never }).send(msg)).toEqual({ ok: true });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer re_key');
    expect(JSON.parse(init.body as string)).toEqual({
      from: 'SpendNote <hello@example.com>', to: ['ama@example.com'], subject: 'S', html: '<p>H</p>', text: 'T',
    });
  });

  it('maps API errors, rate limits and network failures', async () => {
    const bad = createBrevoSender({ apiKey: 'k', from, fetch: (async () => reply(401)) as never });
    expect(await bad.send(msg)).toEqual({ ok: false, status: 401, retryAfter: undefined });
    const limited = createResendSender({
      apiKey: 'k', from,
      fetch: (async () => new Response('{}', { status: 429, headers: { 'retry-after': '30' } })) as never,
    });
    expect(await limited.send(msg)).toEqual({ ok: false, status: 429, retryAfter: 30 });
    const offline = createBrevoSender({ apiKey: 'k', from, fetch: (async () => { throw new TypeError('network'); }) as never });
    expect(await offline.send(msg)).toEqual({ ok: false, status: 0 });
  });

  it('parses the sender setting', () => {
    expect(parseFrom('SpendNote <hello@example.com>')).toEqual(from);
    expect(parseFrom('"Sky Designers" <team@sky.example>')).toEqual({ name: 'Sky Designers', email: 'team@sky.example' });
    expect(parseFrom('hello@example.com')).toEqual(from);
    expect(parseFrom('not an email')).toBeNull();
  });

  it('renders a plain, readable code email', () => {
    const e = renderCodeEmail('048213', 10);
    expect(e.subject).toBe('048213 is your SpendNote sign-in code');
    expect(e.text).toContain('048213');
    expect(e.text).toContain('10 minutes');
    expect(e.html).toContain('048213');
    expect(e.html).toContain('SpendNote by O.B (Osei-Bonsu)');
  });
});
