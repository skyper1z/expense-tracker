import { ClipboardCheck, Download, House, Plus, ReceiptText, Settings, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { needsAttention } from '../lib/calc';
import { useData } from '../state/data';
import { useSlabVisible } from '../state/dock';
import { promptInstall, useInstall } from '../state/install';
import { hrefFor, useRoute, type RouteName } from '../state/router';
import { useUi } from '../state/ui';
import { LogoMark } from './icons';
import { cx } from './ui';

const NAV: { name: RouteName; label: string; icon: LucideIcon }[] = [
  { name: 'overview', label: 'Overview', icon: House },
  { name: 'expenses', label: 'Expenses', icon: ReceiptText },
  { name: 'review', label: 'Review', icon: ClipboardCheck },
  { name: 'settings', label: 'Settings', icon: Settings },
];

function useAttentionCount() {
  const { data } = useData();
  return data.transactions.filter(needsAttention).length;
}

function NavBadge({ count, className }: { count: number; className?: string }) {
  if (count === 0) return null;
  return (
    <span
      aria-hidden
      className={cx(
        'tnum inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-flame-500 px-1 text-[11px] font-bold text-white',
        className,
      )}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}

function Sidebar() {
  const route = useRoute();
  const { openSheet } = useUi();
  const attention = useAttentionCount();
  const install = useInstall();
  return (
    <aside className="sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-white/[0.06] bg-ink-950 px-3 py-6 md:flex md:w-[96px] xl:w-[244px] xl:px-5">
      <a href={hrefFor('overview')} className="flex items-center justify-center gap-3 rounded-2xl p-1 xl:justify-start xl:px-2">
        <LogoMark size={44} />
        <span className="hidden text-[19px] font-semibold tracking-[-0.02em] xl:block">SpendNote</span>
        <span className="sr-only xl:hidden">SpendNote</span>
      </a>
      <button
        type="button"
        onClick={() => openSheet({ kind: 'tx-new' })}
        className="btn-flame mx-auto mt-8 inline-flex h-14 w-14 items-center justify-center gap-2 rounded-full text-[15px] font-semibold xl:mx-0 xl:w-full"
      >
        <Plus size={22} strokeWidth={2} aria-hidden />
        <span className="sr-only xl:not-sr-only">Add expense</span>
      </button>
      <nav aria-label="Main" className="mt-6">
        <ul className="flex flex-col gap-1">
          {NAV.map(({ name, label, icon: Icon }) => {
            const active = route.name === name;
            return (
              <li key={name}>
                <a
                  href={hrefFor(name)}
                  aria-current={active ? 'page' : undefined}
                  className={cx(
                    'relative flex flex-col items-center gap-1.5 rounded-2xl px-2 py-3 text-[12px] font-medium transition-colors xl:flex-row xl:gap-3 xl:px-4 xl:text-[15px]',
                    active ? 'bg-white/[0.07] text-white' : 'text-white/60 hover:bg-white/[0.04] hover:text-white',
                  )}
                >
                  <Icon size={23} strokeWidth={1.5} aria-hidden />
                  <span>{label}</span>
                  {name === 'review' && (
                    <>
                      <NavBadge count={attention} className="absolute right-3 top-2 xl:static xl:ml-auto" />
                      {attention > 0 && <span className="sr-only">, {attention} need attention</span>}
                    </>
                  )}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="mt-auto">
        {install.canPrompt && (
          <button
            type="button"
            onClick={() => promptInstall()}
            className="flex w-full flex-col items-center gap-1.5 rounded-2xl px-2 py-3 text-[12px] font-medium text-white/70 hover:bg-white/[0.04] hover:text-white xl:flex-row xl:gap-3 xl:px-4 xl:text-[15px]"
          >
            <Download size={22} strokeWidth={1.5} aria-hidden />
            Install app
          </button>
        )}
      </div>
    </aside>
  );
}

function MobileChrome() {
  const route = useRoute();
  const { openSheet } = useUi();
  const attention = useAttentionCount();
  const slabVisible = useSlabVisible();
  const showDock = !(route.name === 'overview' && slabVisible);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 md:hidden">
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-[150px] bg-[linear-gradient(180deg,rgba(10,10,10,0)_0%,rgba(10,10,10,0.88)_45%,#0a0a0a_100%)]"
      />
      <div
        className={cx(
          'relative flex justify-center px-4 pb-3 transition-[opacity,transform] duration-200',
          showDock ? 'opacity-100' : 'pointer-events-none translate-y-3 opacity-0',
        )}
      >
        <button
          type="button"
          tabIndex={showDock ? 0 : -1}
          aria-hidden={!showDock}
          onClick={() => openSheet({ kind: 'tx-new' })}
          className="btn-flame pointer-events-auto inline-flex h-[52px] min-w-[210px] items-center justify-center gap-2 rounded-full px-6 text-[16px] font-semibold"
        >
          <Plus size={21} strokeWidth={2} aria-hidden />
          Add expense
        </button>
      </div>
      <nav
        aria-label="Main"
        className="pointer-events-auto relative border-t border-white/[0.07] bg-ink-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl"
      >
        <ul className="mx-auto grid max-w-[520px] grid-cols-4">
          {NAV.map(({ name, label, icon: Icon }) => {
            const active = route.name === name;
            return (
              <li key={name}>
                <a
                  href={hrefFor(name)}
                  aria-current={active ? 'page' : undefined}
                  className={cx(
                    'relative flex h-16 flex-col items-center justify-center gap-1 text-[12px] font-medium transition-colors',
                    active ? 'text-white' : 'text-white/55 hover:text-white/80',
                  )}
                >
                  <span className="relative">
                    <Icon size={24} strokeWidth={active ? 1.8 : 1.5} aria-hidden />
                    {name === 'review' && <NavBadge count={attention} className="absolute -right-3 -top-1.5" />}
                  </span>
                  {label}
                  {name === 'review' && attention > 0 && <span className="sr-only">, {attention} need attention</span>}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}

function DemoBanner() {
  const { exitDemo } = useData();
  const { toast } = useUi();
  return (
    <div className="sticky top-0 z-30 border-b border-flame-500/20 bg-[#170d08]/95 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1240px] items-center gap-3 px-4 py-2.5 sm:px-6 lg:px-10">
        <span className="shrink-0 rounded-full border border-flame-400/40 px-2.5 py-0.5 text-[12px] font-semibold uppercase tracking-[0.06em] text-flame-300">
          Demo
        </span>
        <p className="min-w-0 flex-1 text-[14px] leading-snug text-white/80">
          Sample data only. <span className="hidden sm:inline">Your own records aren’t touched.</span>
        </p>
        <button
          type="button"
          onClick={async () => {
            await exitDemo();
            toast('Demo closed. You’re back to your own records.');
          }}
          className="h-9 shrink-0 rounded-full bg-white px-4 text-[14px] font-semibold text-black hover:bg-white/90"
        >
          Exit demo
        </button>
      </div>
    </div>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const route = useRoute();
  const { mode, persistent } = useData();
  const main = useRef<HTMLElement>(null);
  const first = useRef(true);

  // Move focus and scroll to the top when switching screens (not when only filters change).
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    window.scrollTo({ top: 0 });
    main.current?.focus({ preventScroll: true });
  }, [route.name]);

  const demo = mode === 'demo';
  return (
    <div className="min-h-dvh md:flex">
      <button
        type="button"
        className="skip-link"
        onClick={() => main.current?.focus()}
      >
        Skip to content
      </button>
      <Sidebar />
      <div className="min-w-0 flex-1">
        {demo && <DemoBanner />}
        {!persistent && (
          <div className="border-b border-amber-300/20 bg-amber-300/[0.07] px-4 py-2.5 text-center text-[14px] text-amber-100">
            This browser isn’t allowing storage, so entries will be lost when you close the page.
          </div>
        )}
        <main
          ref={main}
          id="main"
          tabIndex={-1}
          className={cx(
            'mx-auto w-full max-w-[1240px] px-4 outline-none sm:px-6 lg:px-10',
            demo ? 'pt-5' : 'pt-[calc(env(safe-area-inset-top)+16px)]',
            'pb-[calc(env(safe-area-inset-bottom)+164px)] md:pb-16 md:pt-8',
          )}
        >
          {children}
        </main>
      </div>
      <MobileChrome />
    </div>
  );
}
