import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AUTH_STORAGE_KEY, supabase } from '../lib/supabase';

export interface AuthUser {
  id: string;
  email: string;
}

export type AuthStatus = 'unconfigured' | 'loading' | 'signed-out' | 'signed-in';

export type CodeResult = { ok: true; resendAfter: number } | { ok: false; message: string; retryAfter?: number };
export type VerifyResult = { ok: true } | { ok: false; message: string; retryAfter?: number };

interface AuthApi {
  status: AuthStatus;
  user: AuthUser | null;
  /** Asks the server to email a one-time code. */
  sendCode(email: string): Promise<CodeResult>;
  /** Checks the code; on success the user is signed in. */
  verifyCode(email: string, code: string): Promise<VerifyResult>;
  signOut(): Promise<void>;
}

/*
 * Who is signed in is also remembered here (not just in Supabase's session), so the app opens
 * straight to the user's records offline, even if the access token has expired. Syncing
 * refreshes the token when the device is back online.
 */
const IDENTITY_KEY = 'spendnote.identity';

function readIdentity(): AuthUser | null {
  try {
    const v = JSON.parse(localStorage.getItem(IDENTITY_KEY) ?? 'null');
    return v && typeof v.id === 'string' && typeof v.email === 'string' ? v : null;
  } catch {
    return null;
  }
}

function writeIdentity(u: AuthUser | null) {
  try {
    if (u) localStorage.setItem(IDENTITY_KEY, JSON.stringify(u));
    else localStorage.removeItem(IDENTITY_KEY);
  } catch {
    /* storage blocked */
  }
}

const OFFLINE = 'You’re offline. Connect to the internet to sign in.';

async function callFunction<T>(name: string, body: Record<string, unknown>): Promise<{ data: T } | { error: string; retryAfter?: number }> {
  if (!supabase) return { error: 'Sign-in isn’t set up for this copy of SpendNote yet.' };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { error: OFFLINE };
  const { data, error } = await supabase.functions.invoke<T>(name, { body });
  if (!error) return { data: data as T };
  if (error instanceof FunctionsHttpError) {
    try {
      const payload = await (error.context as Response).json();
      return { error: payload?.message ?? 'Something went wrong. Try again.', retryAfter: payload?.retryAfter };
    } catch {
      return { error: 'Something went wrong. Try again.' };
    }
  }
  if (error instanceof FunctionsFetchError) {
    return { error: navigator.onLine === false ? OFFLINE : 'We couldn’t reach the server. Check your connection and try again.' };
  }
  return { error: 'Something went wrong. Try again.' };
}

const AuthContext = createContext<AuthApi | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(() => (supabase ? readIdentity() : null));
  const [status, setStatus] = useState<AuthStatus>(() => (!supabase ? 'unconfigured' : readIdentity() ? 'signed-in' : 'loading'));

  const setSignedIn = useCallback((u: AuthUser) => {
    writeIdentity(u);
    setUser(u);
    setStatus('signed-in');
  }, []);

  const setSignedOut = useCallback(() => {
    writeIdentity(null);
    setUser(null);
    setStatus('signed-out');
  }, []);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      const u = data.session?.user;
      if (u?.email) setSignedIn({ id: u.id, email: u.email });
      // No stored session: signed out, unless we remember the user (offline with an expired token).
      else if (!readIdentity()) setStatus('signed-out');
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') setSignedOut();
      else if (session?.user?.email && (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED')) {
        const current = readIdentity();
        if (!current || current.id !== session.user.id || current.email !== session.user.email) {
          setSignedIn({ id: session.user.id, email: session.user.email });
        }
      }
    });
    // Signing in or out in another tab.
    const onStorage = (e: StorageEvent) => {
      if (e.key !== IDENTITY_KEY) return;
      const u = readIdentity();
      if (u) {
        setUser(u);
        setStatus('signed-in');
      } else {
        setUser(null);
        setStatus('signed-out');
      }
    };
    window.addEventListener('storage', onStorage);
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
      window.removeEventListener('storage', onStorage);
    };
  }, [setSignedIn, setSignedOut]);

  const api = useMemo<AuthApi>(
    () => ({
      status,
      user,
      async sendCode(email) {
        const res = await callFunction<{ ok: boolean; resendAfter?: number }>('auth-send-otp', { email });
        if ('error' in res) return { ok: false, message: res.error, retryAfter: res.retryAfter };
        return { ok: true, resendAfter: res.data?.resendAfter ?? 60 };
      },
      async verifyCode(email, code) {
        const res = await callFunction<{ session: { access_token: string; refresh_token: string }; user: AuthUser }>(
          'auth-verify-otp',
          { email, code },
        );
        if ('error' in res) return { ok: false, message: res.error, retryAfter: res.retryAfter };
        const { error } = await supabase!.auth.setSession({
          access_token: res.data.session.access_token,
          refresh_token: res.data.session.refresh_token,
        });
        if (error) return { ok: false, message: 'Your code was right, but we couldn’t start your session. Try again.' };
        setSignedIn({ id: res.data.user.id, email: res.data.user.email });
        return { ok: true };
      },
      async signOut() {
        try {
          await supabase?.auth.signOut({ scope: 'local' });
        } catch {
          /* offline: we still clear everything locally below */
        }
        try {
          localStorage.removeItem(AUTH_STORAGE_KEY);
          localStorage.removeItem(`${AUTH_STORAGE_KEY}-code-verifier`);
        } catch {
          /* storage blocked */
        }
        setSignedOut();
      },
    }),
    [status, user, setSignedIn, setSignedOut],
  );

  return <AuthContext.Provider value={api}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
