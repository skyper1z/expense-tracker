import { describe, expect, it, vi } from 'vitest';
import { AUTHENTICA_BASE_URL, createAuthenticaClient, type AuthenticaClient } from './authentica.ts';
import { handleSendOtp, handleVerifyOtp, normalizeCode, normalizeEmail, type OtpDeps } from './otp.ts';

const session = {
  access_token: 'access', refresh_token: 'refresh', expires_in: 3600, expires_at: 1, token_type: 'bearer',
  user: { id: 'user-1', email: 'ama@example.com' },
};

function deps(over: Partial<OtpDeps> = {}, auth: Partial<AuthenticaClient> = {}) {
  const d = {
    authentica: {
      sendEmailOtp: vi.fn(async () => ({ ok: true as const })),
      verifyEmailOtp: vi.fn(async () => ({ status: 'valid' as const })),
      ...auth,
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
  return d;
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

describe('input normalisation', () => {
  it('normalises emails and rejects bad ones', () => {
    expect(normalizeEmail('  Ama@Example.COM ')).toBe('ama@example.com');
    expect(normalizeEmail('not-an-email')).toBeNull();
    expect(normalizeEmail(42)).toBeNull();
    expect(normalizeEmail(`${'a'.repeat(250)}@x.com`)).toBeNull();
  });
  it('accepts 4–10 character codes, ignoring spaces', () => {
    expect(normalizeCode('123 456')).toBe('123456');
    expect(normalizeCode('012345')).toBe('012345');
    expect(normalizeCode(1234)).toBe('1234');
    expect(normalizeCode('12')).toBeNull();
    expect(normalizeCode('12345678901')).toBeNull();
    expect(normalizeCode('12<45')).toBeNull();
  });
});

describe('auth-send-otp', () => {
  it('sends a code through Authentica for a valid email', async () => {
    const d = deps();
    const res = await handleSendOtp(req({ email: ' Ama@Example.com ' }, { ip: '1.2.3.4' }), d);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, resendAfter: 60 });
    expect(d.limits.registerSend).toHaveBeenCalledWith('ama@example.com', '1.2.3.4');
    expect(d.authentica.sendEmailOtp).toHaveBeenCalledWith('ama@example.com');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('rejects invalid emails without calling Authentica', async () => {
    const d = deps();
    const res = await handleSendOtp(req({ email: 'nope' }), d);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_email');
    expect(d.authentica.sendEmailOtp).not.toHaveBeenCalled();
    expect((await handleSendOtp(req('{bad json'), d)).status).toBe(400);
  });

  it('enforces the resend cooldown without calling Authentica', async () => {
    const d = deps();
    d.limits.registerSend.mockResolvedValueOnce({ allowed: false, retryAfter: 42, reason: 'cooldown' } as never);
    const res = await handleSendOtp(req({ email: 'ama@example.com' }), d);
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('42');
    expect((await res.json()).message).toMatch(/another in 42 seconds/);
    expect(d.authentica.sendEmailOtp).not.toHaveBeenCalled();
  });

  it('reports Authentica failures without leaking details', async () => {
    const d = deps({}, { sendEmailOtp: vi.fn(async () => ({ ok: false as const, status: 401 })) });
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
    const off = await handleSendOtp(req({ email: 'ama@example.com' }), deps({ configError: 'Missing secrets: AUTHENTICA_API_KEY' }));
    expect(off.status).toBe(500);
    expect((await off.json()).error).toBe('not_configured');
  });
});

describe('auth-verify-otp', () => {
  it('returns a session when Authentica confirms the code', async () => {
    const d = deps();
    const res = await handleVerifyOtp(req({ email: 'Ama@example.com', code: '012 345' }, { ip: '1.2.3.4' }), d);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session.access_token).toBe('access');
    expect(body.user).toEqual({ id: 'user-1', email: 'ama@example.com' });
    expect(d.authentica.verifyEmailOtp).toHaveBeenCalledWith('ama@example.com', '012345');
    expect(d.sessions.issueForEmail).toHaveBeenCalledWith('ama@example.com');
    expect(d.limits.clearFailures).toHaveBeenCalledWith('ama@example.com');
  });

  it('rejects a wrong code, records the attempt and issues no session', async () => {
    const d = deps({}, { verifyEmailOtp: vi.fn(async () => ({ status: 'invalid' as const })) });
    const res = await handleVerifyOtp(req({ email: 'ama@example.com', code: '999999' }, { ip: '1.2.3.4' }), d);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe('invalid_code');
    expect(d.limits.registerVerifyFailure).toHaveBeenCalledWith('ama@example.com', '1.2.3.4');
    expect(d.sessions.issueForEmail).not.toHaveBeenCalled();
  });

  it('stops checking codes after too many wrong attempts', async () => {
    const d = deps();
    d.limits.verifyAllowed.mockResolvedValueOnce({ allowed: false, retryAfter: 600, reason: 'too_many_attempts' } as never);
    const res = await handleVerifyOtp(req({ email: 'ama@example.com', code: '123456' }), d);
    expect(res.status).toBe(429);
    expect((await res.json()).message).toMatch(/10 minutes/);
    expect(d.authentica.verifyEmailOtp).not.toHaveBeenCalled();
  });

  it('validates input and handles Authentica and session errors', async () => {
    expect((await handleVerifyOtp(req({ email: 'ama@example.com', code: '1' }), deps())).status).toBe(400);
    const down = deps({}, { verifyEmailOtp: vi.fn(async () => ({ status: 'error' as const, httpStatus: 503 })) });
    expect((await handleVerifyOtp(req({ email: 'ama@example.com', code: '123456' }), down)).status).toBe(502);
    const noSession = deps();
    noSession.sessions.issueForEmail.mockRejectedValueOnce(new Error('boom'));
    const res = await handleVerifyOtp(req({ email: 'ama@example.com', code: '123456' }), noSession);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe('session_failed');
  });
});

describe('Authentica client', () => {
  const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

  it('sends the documented email OTP request', async () => {
    const fetchMock = vi.fn(async () => reply(200, { success: true, data: null, message: 'OTP send successfully' }));
    const client = createAuthenticaClient({ apiKey: 'secret-key', emailTemplateId: 7, fetch: fetchMock as never });
    expect(await client.sendEmailOtp('ama@example.com')).toEqual({ ok: true });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${AUTHENTICA_BASE_URL}/send-otp`);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['X-Authorization']).toBe('secret-key');
    expect(JSON.parse(init.body as string)).toEqual({ method: 'email', email: 'ama@example.com', template_id: 7 });
  });

  it('treats non-success sends as failures', async () => {
    const unauthorized = createAuthenticaClient({ apiKey: 'k', fetch: (async () => reply(401, { errors: [{ message: 'Unauthorized' }] })) as never });
    expect(await unauthorized.sendEmailOtp('a@b.co')).toEqual({ ok: false, status: 401, retryAfter: undefined });
    const offline = createAuthenticaClient({ apiKey: 'k', fetch: (async () => { throw new TypeError('network'); }) as never });
    expect(await offline.sendEmailOtp('a@b.co')).toEqual({ ok: false, status: 0 });
  });

  it('interprets verify responses', async () => {
    const make = (status: number, body: unknown, headers?: Record<string, string>) =>
      createAuthenticaClient({ apiKey: 'k', fetch: (async () => reply(status, body, headers)) as never });
    expect(await make(200, { status: true, message: 'OTP verified successfully' }).verifyEmailOtp('a@b.co', '012345')).toEqual({ status: 'valid' });
    expect(await make(200, { status: false, message: 'Invalid OTP' }).verifyEmailOtp('a@b.co', '1')).toEqual({ status: 'invalid' });
    expect(await make(422, { message: 'Invalid' }).verifyEmailOtp('a@b.co', '1')).toEqual({ status: 'invalid' });
    expect(await make(429, {}, { 'retry-after': '30' }).verifyEmailOtp('a@b.co', '1')).toEqual({ status: 'rate_limited', retryAfter: 30 });
    expect(await make(500, {}).verifyEmailOtp('a@b.co', '1')).toEqual({ status: 'error', httpStatus: 500 });
  });

  it('sends the code as a string so leading zeros survive', async () => {
    const fetchMock = vi.fn(async () => reply(200, { status: true }));
    await createAuthenticaClient({ apiKey: 'k', fetch: fetchMock as never }).verifyEmailOtp('a@b.co', '001234');
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ email: 'a@b.co', otp: '001234' });
  });
});
