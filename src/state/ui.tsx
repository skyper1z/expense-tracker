import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Transaction } from '../lib/types';

export type SheetSpec =
  | { kind: 'tx-new'; preset?: Partial<Transaction>; paste?: boolean }
  | { kind: 'tx-edit'; id: string }
  | { kind: 'tx-detail'; id: string; focusNote?: boolean }
  | { kind: 'account'; id?: string }
  | { kind: 'category'; id?: string };

export interface ToastSpec {
  id: number;
  message: string;
  tone: 'default' | 'error';
  action?: { label: string; onAction: () => void };
}

export interface ConfirmSpec {
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'danger' | 'default';
}

interface UiApi {
  sheet: SheetSpec | null;
  sheetClosing: boolean;
  /** Open (or replace) the current sheet. */
  openSheet(s: SheetSpec): void;
  /** Close, asking the open form first if it has unsaved changes. */
  requestCloseSheet(): Promise<void>;
  /** Close immediately, e.g. after saving. */
  closeSheet(): void;
  /** Lets an open form block closing while it has unsaved changes. */
  setCloseGuard(guard: (() => Promise<boolean>) | null): void;
  toasts: ToastSpec[];
  toast(message: string, opts?: { tone?: 'default' | 'error'; action?: ToastSpec['action']; duration?: number }): void;
  dismissToast(id: number): void;
  confirmSpec: ConfirmSpec | null;
  confirm(spec: ConfirmSpec): Promise<boolean>;
  resolveConfirm(ok: boolean): void;
}

const UiContext = createContext<UiApi | null>(null);

const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function UiProvider({ children }: { children: ReactNode }) {
  const [sheet, setSheet] = useState<SheetSpec | null>(null);
  const [sheetClosing, setSheetClosing] = useState(false);
  const [toasts, setToasts] = useState<ToastSpec[]>([]);
  const [confirmSpec, setConfirmSpec] = useState<ConfirmSpec | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const guard = useRef<(() => Promise<boolean>) | null>(null);
  const confirmResolver = useRef<((ok: boolean) => void) | null>(null);
  const closeTimer = useRef<number | undefined>(undefined);
  const sheetRef = useRef(sheet);
  sheetRef.current = sheet;
  const toastSeq = useRef(0);

  const openSheet = useCallback((s: SheetSpec) => {
    window.clearTimeout(closeTimer.current);
    if (!sheetRef.current) opener.current = document.activeElement as HTMLElement | null;
    guard.current = null;
    setSheetClosing(false);
    setSheet(s);
  }, []);

  const closeSheet = useCallback(() => {
    if (!sheetRef.current) return;
    guard.current = null;
    setSheetClosing(true);
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(
      () => {
        setSheet(null);
        setSheetClosing(false);
        const el = opener.current;
        opener.current = null;
        // Return focus to whatever opened the sheet; if that's gone (e.g. an empty state that was
        // replaced), land on the main content rather than leaving keyboard users on <body>.
        if (el && document.contains(el) && el !== document.body) el.focus({ preventScroll: true });
        else document.getElementById('main')?.focus({ preventScroll: true });
      },
      reducedMotion() ? 0 : 200,
    );
  }, []);

  const requestCloseSheet = useCallback(async () => {
    if (guard.current && !(await guard.current())) return;
    closeSheet();
  }, [closeSheet]);

  const setCloseGuard = useCallback((g: (() => Promise<boolean>) | null) => {
    guard.current = g;
  }, []);

  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const toast = useCallback<UiApi['toast']>(
    (message, opts = {}) => {
      toastSeq.current += 1;
      const id = toastSeq.current;
      setToasts((t) => [...t.slice(-2), { id, message, tone: opts.tone ?? 'default', action: opts.action }]);
      window.setTimeout(() => dismissToast(id), opts.duration ?? (opts.action ? 7000 : 4000));
    },
    [dismissToast],
  );

  const confirm = useCallback((spec: ConfirmSpec) => {
    confirmResolver.current?.(false);
    setConfirmSpec(spec);
    return new Promise<boolean>((resolve) => {
      confirmResolver.current = resolve;
    });
  }, []);

  const resolveConfirm = useCallback((ok: boolean) => {
    confirmResolver.current?.(ok);
    confirmResolver.current = null;
    setConfirmSpec(null);
  }, []);

  const api = useMemo<UiApi>(
    () => ({
      sheet, sheetClosing, openSheet, requestCloseSheet, closeSheet, setCloseGuard,
      toasts, toast, dismissToast, confirmSpec, confirm, resolveConfirm,
    }),
    [sheet, sheetClosing, openSheet, requestCloseSheet, closeSheet, setCloseGuard, toasts, toast, dismissToast, confirmSpec, confirm, resolveConfirm],
  );

  return <UiContext.Provider value={api}>{children}</UiContext.Provider>;
}

export function useUi(): UiApi {
  const ctx = useContext(UiContext);
  if (!ctx) throw new Error('useUi must be used inside UiProvider');
  return ctx;
}
