import { X } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx, IconButton } from './ui';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

function trapTab(e: React.KeyboardEvent, root: HTMLElement | null) {
  if (e.key !== 'Tab' || !root) return;
  const items = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement);
  if (items.length === 0) {
    e.preventDefault();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  if (e.shiftKey && (document.activeElement === first || document.activeElement === root)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

let lockCount = 0;
function useScrollLock() {
  useEffect(() => {
    lockCount += 1;
    const body = document.body;
    const prev = body.style.overflow;
    body.style.overflow = 'hidden';
    return () => {
      lockCount -= 1;
      if (lockCount === 0) body.style.overflow = prev === 'hidden' ? '' : prev;
    };
  }, []);
}

/**
 * A bottom sheet on phones and a centred modal on larger screens.
 * Traps focus, closes on Escape or backdrop tap, and sits above the on-screen keyboard.
 */
export function Sheet({
  labelledBy,
  onClose,
  closing,
  children,
  wide,
}: {
  labelledBy: string;
  onClose: () => void;
  closing?: boolean;
  children: ReactNode;
  wide?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useScrollLock();

  // Escape works even before focus has moved into the sheet. A confirm dialog on top handles its own Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('[role="alertdialog"]')) return;
      onCloseRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const root = panel.current;
    if (!root) return;
    const target = root.querySelector<HTMLElement>('[data-autofocus]') ?? root;
    // Let the entrance animation start before focusing so mobile browsers don't jump. If the user has
    // already tapped into a field by then, leave their focus alone (don't pull typing into another field).
    const t = window.setTimeout(() => {
      if (root.contains(document.activeElement) && document.activeElement !== root) return;
      target.focus({ preventScroll: true });
    }, 30);
    return () => window.clearTimeout(t);
  }, []);

  const onFocusIn = (e: React.FocusEvent) => {
    const el = e.target as HTMLElement;
    if (window.innerWidth >= 768 || !el.matches('input, textarea, select')) return;
    // After the keyboard opens, make sure the field isn't hidden behind it or the sticky footer.
    window.setTimeout(() => el.scrollIntoView({ block: 'center', behavior: 'smooth' }), 320);
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-6">
      <div
        aria-hidden
        onClick={onClose}
        className={cx('absolute inset-0 bg-black/70', closing ? 'animate-fade-out' : 'animate-fade-in')}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onKeyDown={(e) => trapTab(e, panel.current)}
        onFocus={onFocusIn}
        className={cx(
          'relative flex w-full flex-col overflow-hidden border border-white/[0.07] bg-ink-900 shadow-[0_-20px_60px_-20px_rgba(0,0,0,0.8)] outline-none',
          'rounded-t-[32px] md:rounded-[32px]',
          wide ? 'md:max-w-[680px]' : 'md:max-w-[560px]',
          closing ? 'animate-sheet-down md:animate-pop-out' : 'animate-sheet-up md:animate-pop-in',
        )}
        style={{
          maxHeight: 'min(calc(var(--vvh, 100dvh) - max(env(safe-area-inset-top), 16px) - 8px), 900px)',
          marginBottom: 'var(--kb, 0px)',
        }}
      >
        <div aria-hidden className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-white/20 md:hidden" />
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function SheetHeader({
  id,
  title,
  onClose,
  leading,
  subtitle,
}: {
  id: string;
  title: ReactNode;
  onClose: () => void;
  leading?: ReactNode;
  subtitle?: ReactNode;
}) {
  return (
    <div className="flex shrink-0 items-center gap-3 px-5 pb-3 pt-3 sm:px-7 md:pt-6">
      {leading}
      <div className="min-w-0 flex-1">
        <h2 id={id} className="truncate text-[20px] font-semibold tracking-[-0.01em] text-white">
          {title}
        </h2>
        {subtitle && <p className="mt-0.5 truncate text-[14px] text-white/60">{subtitle}</p>}
      </div>
      <IconButton icon={X} label="Close" onClick={onClose} tone="dark" size={42} />
    </div>
  );
}

export function SheetBody({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-6 pt-1 sm:px-7', className)}>
      {children}
    </div>
  );
}

export function SheetFooter({ children }: { children: ReactNode }) {
  return (
    <div className="shrink-0 border-t border-white/[0.06] bg-ink-900 px-5 pt-4 sm:px-7 pb-[max(16px,env(safe-area-inset-bottom))] md:pb-6">
      {children}
    </div>
  );
}

/** Small centred confirmation dialog, used above sheets too. */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  tone = 'default',
  onResolve,
}: {
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'danger' | 'default';
  onResolve: (ok: boolean) => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useScrollLock();
  useEffect(() => {
    opener.current = document.activeElement as HTMLElement | null;
    cancel.current?.focus();
    return () => {
      const el = opener.current;
      if (el && document.contains(el)) el.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div aria-hidden className="absolute inset-0 animate-fade-in bg-black/75" onClick={() => onResolve(false)} />
      <div
        ref={panel}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby={body ? 'confirm-body' : undefined}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onResolve(false);
          }
          trapTab(e, panel.current);
        }}
        className="relative w-full max-w-[420px] animate-pop-in rounded-[28px] border border-white/[0.08] bg-ink-850 p-6 shadow-2xl"
      >
        <h2 id="confirm-title" className="text-[19px] font-semibold text-white">
          {title}
        </h2>
        {body && (
          <div id="confirm-body" className="mt-2 text-[15px] leading-relaxed text-white/70">
            {body}
          </div>
        )}
        <div className="mt-6 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
          <button
            ref={cancel}
            type="button"
            onClick={() => onResolve(false)}
            className="h-12 rounded-full border border-white/[0.09] bg-white/[0.07] px-5 font-medium text-white hover:bg-white/[0.11]"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={() => onResolve(true)}
            className={cx(
              'h-12 rounded-full px-5 font-semibold',
              tone === 'danger' ? 'bg-danger-400 text-black hover:bg-danger-300' : 'btn-flame',
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
