import { useEffect, useRef, useState } from 'react';
import { needsAttention } from './lib/calc';
import { REQUIRE_INSTALL } from './lib/config';
import { nextOccurrence, showReminderNotification } from './lib/reminders';
import { LogoMark } from './components/icons';
import { ConfirmDialog } from './components/Sheet';
import { Button } from './components/ui';
import { Shell } from './components/Shell';
import { Toasts } from './components/Toasts';
import { Expenses } from './screens/Expenses';
import { FirstRun } from './screens/FirstRun';
import { Overview } from './screens/Overview';
import { Review } from './screens/Review';
import { Settings } from './screens/Settings';
import { InstallGate } from './screens/InstallGate';
import { SignIn } from './screens/SignIn';
import { AccountSheet } from './sheets/AccountSheet';
import { CategorySheet } from './sheets/CategorySheet';
import { TransactionDetail } from './sheets/TransactionDetail';
import { TransactionSheet } from './sheets/TransactionSheet';
import { AuthProvider, useAuth } from './state/auth';
import { DataProvider, useData } from './state/data';
import { useInstall } from './state/install';
import { useKeyboardInsets } from './state/hooks';
import { useRoute } from './state/router';
import { UiProvider, useUi } from './state/ui';

function SheetHost() {
  const { sheet, sheetClosing } = useUi();
  const { data } = useData();
  if (!sheet) return null;
  switch (sheet.kind) {
    case 'tx-new':
      return <TransactionSheet preset={sheet.preset} startWithPaste={sheet.paste} closing={sheetClosing} />;
    case 'tx-edit': {
      const tx = data.transactions.find((t) => t.id === sheet.id);
      return tx ? <TransactionSheet key={`edit-${tx.id}`} existing={tx} closing={sheetClosing} /> : null;
    }
    case 'tx-detail':
      return <TransactionDetail key={`detail-${sheet.id}`} id={sheet.id} focusNote={sheet.focusNote} closing={sheetClosing} />;
    case 'account':
      return <AccountSheet key={`acc-${sheet.id ?? 'new'}`} id={sheet.id} closing={sheetClosing} />;
    case 'category':
      return <CategorySheet key={`cat-${sheet.id ?? 'new'}`} id={sheet.id} closing={sheetClosing} />;
  }
}

function ConfirmHost() {
  const { confirmSpec, resolveConfirm } = useUi();
  if (!confirmSpec) return null;
  return <ConfirmDialog {...confirmSpec} onResolve={resolveConfirm} />;
}

/**
 * While SpendNote is open (even in a background tab), show a notification at the
 * weekly reminder time if the user has allowed notifications. Nothing runs when
 * the app is closed: there is no push server.
 */
function ReminderRunner() {
  const { data, ready } = useData();
  const r = data.settings.reminder;
  const countRef = useRef(0);
  countRef.current = data.transactions.filter(needsAttention).length;
  useEffect(() => {
    if (!ready || !r.enabled) return;
    let timer = 0;
    const arm = () => {
      const next = nextOccurrence(r, new Date());
      const ms = Math.min(next.getTime() - Date.now(), 2 ** 31 - 1);
      timer = window.setTimeout(() => {
        if (Date.now() >= next.getTime() - 1000) {
          const n = countRef.current;
          showReminderNotification(
            n > 0 ? `${n} ${n === 1 ? 'expense needs' : 'expenses need'} a note. Take a minute to review your week.` : 'Take a minute to look over this week’s spending.',
          );
        }
        arm();
      }, Math.max(1000, ms));
    };
    arm();
    return () => window.clearTimeout(timer);
  }, [ready, r]);
  return null;
}

function Screen() {
  const route = useRoute();
  switch (route.name) {
    case 'expenses':
      return <Expenses />;
    case 'review':
      return <Review />;
    case 'settings':
      return <Settings />;
    default:
      return <Overview />;
  }
}

/** Matches the static splash in index.html, so there's no jump when the app takes over. */
function LoadingScreen() {
  return (
    <div
      role="status"
      aria-label="Loading SpendNote by O.B (Osei-Bonsu)"
      className="flex min-h-dvh flex-col items-center justify-center px-6 text-center"
    >
      <LogoMark size={64} className="animate-pulse" />
      <p className="mt-[18px] text-[26px] font-semibold leading-tight tracking-[-0.02em] text-white">SpendNote</p>
      <p className="mt-1.5 text-[15px] text-white/60">by O.B (Osei-Bonsu)</p>
    </div>
  );
}

/** First sign-in on this device: wait for the account's records before showing an empty app. */
function InitialSyncScreen() {
  const { sync, syncNow, skipInitialSync } = useData();
  const stuck = sync.status === 'error' || sync.status === 'offline';
  return (
    <div role="status" className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
      <LogoMark size={64} className={stuck ? '' : 'animate-pulse'} />
      <p className="mt-[18px] text-[22px] font-semibold tracking-[-0.02em] text-white">
        {stuck ? 'Couldn’t load your records yet' : 'Getting your records…'}
      </p>
      <p className="mt-2 max-w-[340px] text-[15px] leading-relaxed text-white/60">
        {sync.status === 'offline'
          ? 'You’re offline. Connect to download your records, or continue and they’ll appear once you’re back online.'
          : stuck
            ? 'Something went wrong while downloading. Try again, or continue and SpendNote will keep trying.'
            : 'This only happens the first time you sign in on this device.'}
      </p>
      {stuck && (
        <div className="mt-6 flex gap-3">
          <Button variant="white" onClick={() => void syncNow()}>
            Try again
          </Button>
          <Button variant="secondary" onClick={skipInitialSync}>
            Continue
          </Button>
        </div>
      )}
    </div>
  );
}

/** Offers, once, to move records saved on this device before accounts existed into the account. */
function LegacyImport() {
  const { findLegacyRecords, importLegacyRecords, discardLegacyRecords } = useData();
  const { confirm, toast } = useUi();
  const { user } = useAuth();
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    let skip = false;
    try {
      skip = sessionStorage.getItem('spendnote.legacyAsked') === '1';
    } catch {
      /* ignore */
    }
    if (skip) return;
    void findLegacyRecords().then(async (found) => {
      if (!found) return;
      const add = await confirm({
        title: 'Add records from this device?',
        body: `This device has ${found.transactions} ${found.transactions === 1 ? 'entry' : 'entries'} saved before you signed in. Add ${found.transactions === 1 ? 'it' : 'them'} to your account${user ? ` (${user.email})` : ''}?`,
        confirmLabel: 'Add to my account',
        cancelLabel: 'Not now',
      });
      if (add) {
        await importLegacyRecords(found.data);
        toast(`Added ${found.transactions} ${found.transactions === 1 ? 'entry' : 'entries'} to your account.`);
      } else {
        try {
          sessionStorage.setItem('spendnote.legacyAsked', '1');
        } catch {
          /* ignore */
        }
      }
    });
  }, [findLegacyRecords, importLegacyRecords, discardLegacyRecords, confirm, toast, user]);
  return null;
}

function Root() {
  const auth = useAuth();
  const { ready, data, mode, sync } = useData();
  // Keep the opening screen up briefly on a cold start so the name can actually be read.
  const [introDone, setIntroDone] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setIntroDone(true), 700);
    return () => window.clearTimeout(t);
  }, []);

  const install = useInstall();
  // In production, phones and tablets must install SpendNote first; a normal browser tab shows how.
  // Computers (Windows, Mac, Linux) can use it straight in the browser.
  const gated = REQUIRE_INSTALL && install.platform !== 'desktop' && !install.runningAsApp;

  let screen: React.ReactNode;
  if (!introDone || auth.status === 'loading') screen = <LoadingScreen />;
  else if (gated) screen = <InstallGate />;
  else if (mode === 'real' && auth.status === 'signed-out') screen = <SignIn />;
  else if (!ready) screen = <LoadingScreen />;
  else if (mode === 'real' && sync.initialPending) screen = <InitialSyncScreen />;
  else if (mode === 'real' && !data.settings.onboarded && data.transactions.length === 0) screen = <FirstRun />;
  else
    screen = (
      <Shell>
        <Screen />
      </Shell>
    );

  const signedInReady = !gated && mode === 'real' && auth.status === 'signed-in' && ready && !sync.initialPending && introDone;
  return (
    <>
      {screen}
      {signedInReady && <LegacyImport />}
      <SheetHost />
      <ConfirmHost />
      <Toasts />
      <ReminderRunner />
    </>
  );
}

export function App() {
  useKeyboardInsets();
  return (
    <AuthProvider>
      <DataProvider>
        <UiProvider>
          <Root />
        </UiProvider>
      </DataProvider>
    </AuthProvider>
  );
}
