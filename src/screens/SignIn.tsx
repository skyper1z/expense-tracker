import { ArrowLeft, Mail, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { LogoMark } from '../components/icons';
import { InstallButton } from '../components/InstallPrompt';
import { Button, TextInput } from '../components/ui';
import { useAuth } from '../state/auth';
import { useData } from '../state/data';
import { Illustration } from './FirstRun';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function useCountdown() {
  const [until, setUntil] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until <= now) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [until, now]);
  const left = Math.max(0, Math.ceil((until - now) / 1000));
  return { left, start: (seconds: number) => { setNow(Date.now()); setUntil(Date.now() + seconds * 1000); } };
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/**
 * Sign in with an emailed one-time code (generated and checked by SpendNote's server). No passwords.
 */
export function SignIn() {
  const auth = useAuth();
  const { enterDemo } = useData();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const resend = useCountdown();
  const codeRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  // Move focus between the two steps, but not on first load (that would pop the phone keyboard
  // over the welcome screen before the person has decided to sign in).
  const firstStep = useRef(true);
  useEffect(() => {
    if (firstStep.current) {
      firstStep.current = false;
      return;
    }
    (step === 'code' ? codeRef : emailRef).current?.focus();
  }, [step]);

  const send = async (again = false) => {
    if (busy) return;
    const clean = email.trim().toLowerCase();
    if (!EMAIL_RE.test(clean)) {
      setError('Enter a valid email address, like ama@example.com.');
      emailRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await auth.sendCode(clean);
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      if (res.retryAfter) resend.start(res.retryAfter);
      return;
    }
    setEmail(clean);
    resend.start(res.resendAfter);
    if (again) {
      setCode('');
      setNotice('We sent a new code. Use the most recent one.');
    }
    setStep('code');
  };

  const verify = async () => {
    if (busy) return;
    const clean = code.replace(/[\s-]+/g, '');
    if (!/^[0-9A-Za-z]{4,10}$/.test(clean)) {
      setError('Enter the code from the email.');
      codeRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    const res = await auth.verifyCode(email, clean);
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      codeRef.current?.select();
    }
  };

  return (
    <main
      id="main"
      className="relative min-h-dvh overflow-hidden px-5 pb-[max(32px,env(safe-area-inset-bottom))] pt-[max(28px,env(safe-area-inset-top))]"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-40 left-1/2 h-[420px] w-[720px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(255,106,26,0.22),transparent)]"
      />
      <div className="relative mx-auto grid min-h-[calc(100dvh-80px)] max-w-[1040px] grid-cols-1 items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <div className="order-2 lg:order-1">
          <div className="flex items-center gap-3">
            <LogoMark size={44} />
            <span className="text-[19px] font-semibold tracking-[-0.02em]">SpendNote</span>
          </div>

          {step === 'email' ? (
            <>
              <h1 className="mt-8 text-[clamp(2.4rem,9vw,3.6rem)] font-semibold leading-[1.02] tracking-[-0.04em]">
                Know where your money goes.
              </h1>
              <p className="mt-5 max-w-[460px] text-[17px] leading-relaxed text-white/70">
                Sign in with your email to keep your expenses safe and in step across your devices. We’ll email you a one-time
                code. There’s no password to remember.
              </p>
              <form
                noValidate
                className="mt-8 max-w-[420px]"
                onSubmit={(e) => {
                  e.preventDefault();
                  void send();
                }}
              >
                <label htmlFor="signin-email" className="mb-2 block text-[15px] font-medium text-white">
                  Email address
                </label>
                <TextInput
                  ref={emailRef}
                  id="signin-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setError(null);
                  }}
                  placeholder="you@example.com"
                  className="h-14 text-[17px]"
                  invalid={!!error}
                  aria-describedby={error ? 'signin-error' : undefined}
                />
                {error && (
                  <p id="signin-error" role="alert" className="mt-2 text-[14px] text-danger-300">
                    {error}
                  </p>
                )}
                <button
                  type="submit"
                  disabled={busy}
                  className="add-slab mt-4 flex h-[64px] w-full items-center justify-center gap-3 rounded-[24px] text-[18px] font-semibold text-white disabled:opacity-60"
                >
                  <Mail size={22} strokeWidth={1.6} aria-hidden />
                  {busy ? 'Sending…' : 'Email me a sign-in code'}
                </button>
              </form>
              <Button
                variant="secondary"
                size="lg"
                icon={Play}
                className="mt-3 w-full max-w-[420px]"
                onClick={() => void enterDemo()}
              >
                Explore demo
              </Button>
              <InstallButton className="mt-2 max-w-[420px]" />
            </>
          ) : (
            <>
              <h1 className="mt-8 text-[clamp(2.1rem,8vw,3rem)] font-semibold leading-[1.05] tracking-[-0.035em]">Check your email</h1>
              <p className="mt-4 max-w-[460px] text-[17px] leading-relaxed text-white/70">
                We sent a sign-in code to <span className="font-semibold text-white">{email}</span>. It can take a minute to arrive.
                Check your spam folder if you don’t see it.
              </p>
              <form
                noValidate
                className="mt-8 max-w-[420px]"
                onSubmit={(e) => {
                  e.preventDefault();
                  void verify();
                }}
              >
                <label htmlFor="signin-code" className="mb-2 block text-[15px] font-medium text-white">
                  Code
                </label>
                <TextInput
                  ref={codeRef}
                  id="signin-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoCapitalize="none"
                  spellCheck={false}
                  maxLength={12}
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value);
                    setError(null);
                  }}
                  placeholder="••••••"
                  className="tnum h-16 text-center text-[28px] font-semibold tracking-[0.35em]"
                  invalid={!!error}
                  aria-describedby={error ? 'signin-error' : notice ? 'signin-notice' : undefined}
                />
                {error ? (
                  <p id="signin-error" role="alert" className="mt-2 text-[14px] text-danger-300">
                    {error}
                  </p>
                ) : notice ? (
                  <p id="signin-notice" role="status" className="mt-2 text-[14px] text-white/70">
                    {notice}
                  </p>
                ) : null}
                <button
                  type="submit"
                  disabled={busy}
                  className="add-slab mt-4 flex h-[64px] w-full items-center justify-center rounded-[24px] text-[18px] font-semibold text-white disabled:opacity-60"
                >
                  {busy ? 'Checking…' : 'Verify and sign in'}
                </button>
              </form>
              <div className="mt-4 flex max-w-[420px] flex-wrap items-center justify-between gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  icon={ArrowLeft}
                  onClick={() => {
                    setStep('email');
                    setCode('');
                    setError(null);
                    setNotice(null);
                  }}
                >
                  Use a different email
                </Button>
                <Button variant="ghost" size="sm" disabled={busy || resend.left > 0} onClick={() => void send(true)}>
                  {resend.left > 0 ? `Resend code in ${mmss(resend.left)}` : 'Resend code'}
                </Button>
              </div>
            </>
          )}
          <p className="mt-6 max-w-[420px] text-[13px] leading-relaxed text-white/50">
            Your email is used only to sign you in. Each code works once and expires after 10 minutes.
          </p>
        </div>
        <div className={step === 'code' ? 'order-1 hidden sm:block lg:order-2' : 'order-1 lg:order-2'}>
          <Illustration />
        </div>
      </div>
    </main>
  );
}
