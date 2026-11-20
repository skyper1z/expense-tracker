/**
 * Wires the OTP handlers to real services inside the Supabase Edge Runtime (Deno).
 *
 * Secrets (set with `supabase secrets set …`, or supabase/functions/.env locally):
 *   BREVO_API_KEY or RESEND_API_KEY   one of these (free email APIs that deliver the codes)
 *   EMAIL_FROM                        sender, e.g. "SpendNote <you@example.com>" (must be verified with the provider)
 *   ALLOWED_ORIGINS                   optional, comma-separated, e.g. https://spendnote.app
 *   OTP_SECRET                        optional; key for hashing codes (defaults to the service role key)
 * Provided automatically by Supabase: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.119.2';
import {
  createBrevoSender, createEmailOtpProvider, createResendSender, parseFrom, type CheckOutcome, type EmailSender,
} from './email-otp.ts';
import type { Gate, IssuedSession, OtpDeps } from './otp.ts';

function toGate(data: unknown): Gate {
  const d = (data ?? {}) as { allowed?: boolean; retry_after?: number; reason?: string };
  return { allowed: d.allowed === true, retryAfter: Number(d.retry_after ?? 0), reason: d.reason };
}

/**
 * Turns an email whose code has been verified into a Supabase session: create the user if new
 * (email confirmed, no password), mint a one-time sign-in token with the admin API (no email is
 * sent), and exchange it for a session server-side. This works with the project's email provider
 * turned off, which is what keeps passwords and Supabase's own email links from ever being used.
 */
export async function issueSessionForEmail(
  admin: SupabaseClient,
  makeAnonClient: () => SupabaseClient,
  email: string,
): Promise<IssuedSession> {
  const created = await admin.auth.admin.createUser({ email, email_confirm: true });
  if (created.error && created.error.code !== 'email_exists' && created.error.status !== 422) throw created.error;

  const link = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (link.error) throw link.error;

  const { data, error } = await makeAnonClient().auth.verifyOtp({
    token_hash: link.data.properties.hashed_token,
    type: 'email',
  });
  if (error) throw error;
  if (!data.session || !data.user) throw new Error('Supabase returned no session');
  return {
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_in: data.session.expires_in,
    expires_at: data.session.expires_at,
    token_type: data.session.token_type,
    user: { id: data.user.id, email: data.user.email ?? email },
  };
}

export function createDeps(): OtpDeps {
  const env = (name: string) => Deno.env.get(name)?.trim() ?? '';
  const url = env('SUPABASE_URL');
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = env('SUPABASE_ANON_KEY');
  const brevoKey = env('BREVO_API_KEY');
  const resendKey = env('RESEND_API_KEY');
  const from = parseFrom(env('EMAIL_FROM'));

  const missing: string[] = [];
  if (!url) missing.push('SUPABASE_URL');
  if (!serviceKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!anonKey) missing.push('SUPABASE_ANON_KEY');
  if (!brevoKey && !resendKey) missing.push('BREVO_API_KEY or RESEND_API_KEY');
  if (!from) missing.push('EMAIL_FROM');

  const noSession = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const admin = createClient(url || 'http://invalid.local', serviceKey || 'missing', noSession);
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await admin.rpc(fn, args);
    if (error) throw error;
    return data;
  };

  const sender: EmailSender | null =
    from && brevoKey ? createBrevoSender({ apiKey: brevoKey, from })
    : from && resendKey ? createResendSender({ apiKey: resendKey, from })
    : null;

  return {
    provider: createEmailOtpProvider({
      sender: sender ?? { name: 'none', send: async () => ({ ok: false, status: 0 }) },
      secret: env('OTP_SECRET') || serviceKey || 'missing',
      store: {
        save: async (email, codeHash, ttlSeconds) => {
          await rpc('otp_store_code', { p_email: email, p_code_hash: codeHash, p_ttl_seconds: ttlSeconds });
        },
        check: async (email, codeHash, maxAttempts) =>
          (await rpc('otp_check_code', { p_email: email, p_code_hash: codeHash, p_max_attempts: maxAttempts })) as CheckOutcome,
      },
    }),
    limits: {
      registerSend: async (email, ip) => toGate(await rpc('otp_register_send', { p_email: email, p_ip: ip })),
      verifyAllowed: async (email, ip) => toGate(await rpc('otp_verify_allowed', { p_email: email, p_ip: ip })),
      registerVerifyFailure: async (email, ip) => {
        await rpc('otp_register_verify_failure', { p_email: email, p_ip: ip });
      },
      clearFailures: async (email) => {
        await rpc('otp_clear_failures', { p_email: email });
      },
    },
    sessions: {
      issueForEmail: (email) => issueSessionForEmail(admin, () => createClient(url, anonKey, noSession), email),
    },
    allowedOrigins: env('ALLOWED_ORIGINS').split(',').map((o) => o.trim()).filter(Boolean),
    configError: missing.length ? `Missing secrets: ${missing.join(', ')}` : undefined,
    log: (message, extra) => console.error(JSON.stringify({ message, ...extra })),
  };
}
