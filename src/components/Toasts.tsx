import { CheckCircle2, X, XCircle } from 'lucide-react';
import { useUi } from '../state/ui';
import { cx } from './ui';

export function Toasts() {
  const { toasts, dismissToast, sheet } = useUi();
  return (
    <div
      role="status"
      aria-live="polite"
      className={cx(
        'pointer-events-none fixed inset-x-0 z-[70] flex flex-col items-center gap-2 px-4 md:inset-x-auto md:bottom-6 md:right-6 md:top-auto md:items-end',
        // On phones, keep toasts clear of an open bottom sheet by showing them at the top.
        sheet ? 'top-[calc(env(safe-area-inset-top)+12px)]' : 'bottom-[calc(env(safe-area-inset-bottom)+152px)]',
      )}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cx(
            'pointer-events-auto flex w-full max-w-[440px] animate-toast-in items-center gap-3 rounded-2xl border py-2.5 pl-4 pr-2 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.9)]',
            t.tone === 'error' ? 'border-danger-400/30 bg-[#2a1414]' : 'border-white/[0.1] bg-ink-750',
          )}
        >
          {t.tone === 'error' ? (
            <XCircle size={19} strokeWidth={1.8} className="shrink-0 text-danger-300" aria-hidden />
          ) : (
            <CheckCircle2 size={19} strokeWidth={1.8} className="shrink-0 text-mint-400" aria-hidden />
          )}
          <p className="min-w-0 flex-1 py-1 text-[14px] leading-snug text-white">{t.message}</p>
          {t.action && (
            <button
              type="button"
              onClick={() => {
                t.action!.onAction();
                dismissToast(t.id);
              }}
              className="h-10 shrink-0 rounded-full bg-white px-4 text-[14px] font-semibold text-black hover:bg-white/90"
            >
              {t.action.label}
            </button>
          )}
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => dismissToast(t.id)}
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white/60 hover:bg-white/[0.07] hover:text-white"
          >
            <X size={17} strokeWidth={1.8} aria-hidden />
          </button>
        </div>
      ))}
    </div>
  );
}
