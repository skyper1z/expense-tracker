import {
  Bell, ChevronRight, Cloud, CloudOff, Download, FileJson, FileSpreadsheet, HardDrive, LogOut, Play, Plus, RefreshCw, Smartphone, Trash2, Upload,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { makeBackup, parseBackup, transactionsToCsv } from '../lib/backup';
import { touchesAccount } from '../lib/calc';
import { sortCategories } from '../lib/categories';
import { formatTime, formatTimestamp, todayISO, WEEKDAYS_LONG } from '../lib/dates';
import { CURRENCIES, currencyInfo } from '../lib/money';
import { nextOccurrence, notificationState, showReminderNotification, type NotificationState } from '../lib/reminders';
import type { CurrencyCode } from '../lib/types';
import { METHOD_LABEL } from '../lib/types';
import { CategoryBadge, MethodIcon } from '../components/icons';
import { Button, Callout, Card, cx, SectionHeader, Select, Switch, TextInput } from '../components/ui';
import { deleteDatabase, userDbName } from '../lib/db';
import { useAuth } from '../state/auth';
import { navigate } from '../state/router';
import { useData } from '../state/data';
import { promptInstall, useInstall } from '../state/install';
import { useUi } from '../state/ui';

function download(filename: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const LAST_BACKUP_KEY = 'spendnote.lastBackupAt';

function Row({ children, onClick, label }: { children: React.ReactNode; onClick?: () => void; label?: string }) {
  if (!onClick) return <div className="flex items-center gap-3.5 py-3">{children}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="-mx-2 flex w-[calc(100%+16px)] items-center gap-3.5 rounded-2xl px-2 py-3 text-left transition-colors hover:bg-white/[0.04]"
    >
      {children}
      <ChevronRight size={18} strokeWidth={1.6} aria-hidden className="shrink-0 text-white/35" />
    </button>
  );
}

function AccountSection() {
  const auth = useAuth();
  const { mode, sync, syncNow, countPending } = useData();
  const { confirm, toast } = useUi();
  const [busy, setBusy] = useState(false);
  if (mode === 'demo' || auth.status !== 'signed-in' || !auth.user) return null;
  const user = auth.user;

  const status =
    sync.status === 'syncing'
      ? { icon: RefreshCw, text: 'Saving to your account…', tone: 'text-white/75' }
      : sync.status === 'offline'
        ? {
            icon: CloudOff,
            text: sync.pending > 0
              ? `You’re offline. ${sync.pending} ${sync.pending === 1 ? 'change' : 'changes'} will be saved when you reconnect.`
              : 'You’re offline. Everything still works on this device.',
            tone: 'text-amber-200',
          }
        : sync.status === 'error'
          ? { icon: CloudOff, text: `Couldn’t sync just now${sync.error ? ` (${sync.error})` : ''}. It will retry automatically.`, tone: 'text-danger-300' }
          : {
              icon: Cloud,
              text: sync.lastSyncedAt ? `All changes saved to your account · ${formatTimestamp(sync.lastSyncedAt)}` : 'Connected to your account.',
              tone: 'text-white/75',
            };

  const signOut = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (navigator.onLine) await syncNow().catch(() => undefined);
      const pending = await countPending();
      const ok = await confirm(
        pending > 0
          ? {
              title: 'Sign out with unsaved changes?',
              body: `${pending} ${pending === 1 ? 'change hasn’t' : 'changes haven’t'} reached your account yet, probably because you’re offline. Signing out now removes ${pending === 1 ? 'it' : 'them'} from this device for good.`,
              confirmLabel: 'Sign out anyway',
              tone: 'danger',
            }
          : {
              title: 'Sign out of SpendNote?',
              body: 'Your records stay safe in your account. This device’s copy is removed; sign in again to get it back.',
              confirmLabel: 'Sign out',
            },
      );
      if (!ok) return;
      // Remove this device's copy first (the open connection closes itself when asked), then end the
      // session, so the sign-in screen only appears once nothing of this account is left here.
      await deleteDatabase(userDbName(user.id));
      await auth.signOut();
      // Start from the Overview next time someone signs in.
      navigate('overview', {}, { replace: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card aria-labelledby="set-account">
      <SectionHeader id="set-account" title="Your account" />
      <p className="text-[14px] text-white/60">Signed in as</p>
      <p className="mt-0.5 break-all text-[16px] font-medium text-white">{user.email}</p>
      <p className={cx('mt-4 flex items-start gap-2 text-[14px] leading-snug', status.tone)} role="status">
        <status.icon size={17} strokeWidth={1.7} aria-hidden className={cx('mt-0.5 shrink-0', sync.status === 'syncing' && 'animate-spin')} />
        {status.text}
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          icon={RefreshCw}
          disabled={sync.status === 'syncing' || busy}
          onClick={async () => {
            await syncNow();
            if (!navigator.onLine) toast('You’re offline. Changes will sync when you reconnect.');
          }}
        >
          Sync now
        </Button>
        <Button size="sm" variant="ghost" icon={LogOut} disabled={busy} onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>
    </Card>
  );
}

function CurrencySection() {
  const { data, updateSettings } = useData();
  const { confirm, toast } = useUi();
  return (
    <Card aria-labelledby="set-currency">
      <SectionHeader id="set-currency" title="Currency" subtitle="SpendNote uses one currency for all your records." />
      <label htmlFor="currency" className="sr-only">
        Currency
      </label>
      <Select
        id="currency"
        value={data.settings.currency}
        onChange={async (e) => {
          const next = e.target.value as CurrencyCode;
          const info = currencyInfo(next);
          if (data.transactions.length > 0) {
            const ok = await confirm({
              title: `Show amounts in ${info.name}?`,
              body: `Amounts aren’t converted. Every existing entry will simply be shown in ${info.symbol.trim()} instead of ${currencyInfo(data.settings.currency).symbol.trim()}. Only do this if your entries were actually in ${info.name}.`,
              confirmLabel: 'Change currency',
            });
            if (!ok) return;
          }
          await updateSettings({ currency: next });
          toast(`Currency set to ${info.name}.`);
        }}
      >
        {CURRENCIES.map((c) => (
          <option key={c.code} value={c.code}>
            {c.symbol.trim()} · {c.name}
          </option>
        ))}
      </Select>
    </Card>
  );
}

function AccountsSection() {
  const { data } = useData();
  const { openSheet } = useUi();
  const linkedCount = (id: string) => data.transactions.filter((t) => touchesAccount(t, id)).length;
  return (
    <Card aria-labelledby="set-accounts">
      <SectionHeader
        id="set-accounts"
        title="Accounts & wallets"
        subtitle="Optional. Name where you pay from, then pick it when you add an expense."
        action={
          <Button size="sm" variant="secondary" icon={Plus} onClick={() => openSheet({ kind: 'account' })}>
            Add
          </Button>
        }
      />
      {data.accounts.length === 0 ? (
        <p className="text-[14px] text-white/60">No accounts yet. You can record spending without any.</p>
      ) : (
        <div className="divide-y divide-white/[0.06]">
          {data.accounts.map((a) => (
            <Row key={a.id} onClick={() => openSheet({ kind: 'account', id: a.id })} label={`Edit ${a.name}`}>
              <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/[0.07]">
                <MethodIcon method={a.method} size={18} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium text-white">{a.name}</span>
                <span className="block truncate text-[13px] text-white/60">
                  {METHOD_LABEL[a.method]} · {linkedCount(a.id)} {linkedCount(a.id) === 1 ? 'entry' : 'entries'}
                </span>
              </span>
            </Row>
          ))}
        </div>
      )}
    </Card>
  );
}

function CategoriesSection() {
  const { data } = useData();
  const { openSheet } = useUi();
  const counts = new Map<string, number>();
  data.transactions.forEach((t) => t.type === 'expense' && counts.set(t.categoryId, (counts.get(t.categoryId) ?? 0) + 1));
  return (
    <Card aria-labelledby="set-cats">
      <SectionHeader
        id="set-cats"
        title="Categories"
        action={
          <Button size="sm" variant="secondary" icon={Plus} onClick={() => openSheet({ kind: 'category' })}>
            Add
          </Button>
        }
      />
      <div className="divide-y divide-white/[0.06]">
        {sortCategories(data.categories).map((c) => (
          <Row
            key={c.id}
            onClick={c.builtIn ? undefined : () => openSheet({ kind: 'category', id: c.id })}
            label={c.builtIn ? undefined : `Edit ${c.name}`}
          >
            <CategoryBadge category={c} size={36} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-medium text-white">{c.name}</span>
              <span className="block text-[13px] text-white/60">
                {c.builtIn ? 'Built in' : 'Custom'} · {counts.get(c.id) ?? 0} {(counts.get(c.id) ?? 0) === 1 ? 'expense' : 'expenses'}
                {c.id === 'fees' && ' · plus fees on any entry'}
              </span>
            </span>
          </Row>
        ))}
      </div>
    </Card>
  );
}

function RemindersSection() {
  const { data, updateSettings, mode } = useData();
  const { toast } = useUi();
  const r = data.settings.reminder;
  const [perm, setPerm] = useState<NotificationState>(notificationState);
  const next = nextOccurrence(r, new Date());
  const hh = String(next.getHours()).padStart(2, '0');
  const mm = String(next.getMinutes()).padStart(2, '0');

  const setReminder = (patch: Partial<typeof r>) =>
    updateSettings({
      reminder: { ...r, ...patch },
      // Enabling or rescheduling counts as "seen", so we don't nag about a time that already passed.
      reminderAckAt: new Date().toISOString(),
    });

  return (
    <Card aria-labelledby="set-remind">
      <SectionHeader id="set-remind" title="Weekly review reminder" />
      <Switch
        checked={r.enabled}
        onChange={(v) => setReminder({ enabled: v })}
        label="Remind me to review my week"
        description="A short nudge to add missing notes and look over your spending."
      />
      {r.enabled && (
        <div className="mt-5 space-y-5">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="rem-day" className="mb-1.5 block text-[14px] font-medium text-white/80">
                Day
              </label>
              <Select id="rem-day" value={r.weekday} onChange={(e) => setReminder({ weekday: Number(e.target.value) })}>
                {WEEKDAYS_LONG.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <label htmlFor="rem-time" className="mb-1.5 block text-[14px] font-medium text-white/80">
                Time
              </label>
              <TextInput
                id="rem-time"
                type="time"
                value={r.time}
                onChange={(e) => /^\d{2}:\d{2}$/.test(e.target.value) && setReminder({ time: e.target.value })}
              />
            </div>
          </div>

          <div className="space-y-2.5 rounded-[20px] border border-white/[0.07] bg-white/[0.03] p-4 text-[14px] leading-snug">
            <p className="text-white">
              <span className="font-semibold">In-app reminder: on.</span>{' '}
              <span className="text-white/70">
                Next one is {WEEKDAYS_LONG[(next.getDay() + 6) % 7]} at {formatTime(`${hh}:${mm}`)}. You’ll see it in SpendNote the
                first time you open it after then.
              </span>
            </p>
            <p className="text-white">
              <span className="font-semibold">Notifications:</span>{' '}
              <span className="text-white/70">
                {perm === 'granted' && 'allowed. If SpendNote is open, even in a background tab, it shows a notification at that time.'}
                {perm === 'default' && 'not turned on.'}
                {perm === 'denied' && 'blocked in your browser’s site settings. The in-app reminder still works.'}
                {perm === 'unsupported' && 'this browser doesn’t support them. The in-app reminder still works.'}
              </span>
            </p>
            <p className="text-white/60">
              Reminders can’t reach you while SpendNote is closed. That would need a push server, which this version doesn’t use.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {perm === 'default' && (
              <Button
                size="sm"
                variant="white"
                icon={Bell}
                onClick={async () => {
                  const result = await Notification.requestPermission();
                  setPerm(result as NotificationState);
                  toast(result === 'granted' ? 'Notifications allowed.' : 'Notifications weren’t allowed. In-app reminders still work.');
                }}
              >
                Allow notifications
              </Button>
            )}
            {perm === 'granted' && (
              <Button
                size="sm"
                variant="secondary"
                icon={Bell}
                onClick={async () => {
                  const ok = await showReminderNotification(
                    mode === 'demo' ? 'This is how your weekly reminder will look (demo).' : 'This is how your weekly reminder will look.',
                  );
                  if (!ok) toast('The browser didn’t show the notification.', { tone: 'error' });
                }}
              >
                Send a test notification
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function InstallSection() {
  const install = useInstall();
  return (
    <Card aria-labelledby="set-install">
      <SectionHeader id="set-install" title="Install the app" />
      {install.installed ? (
        <Callout tone="success">SpendNote is installed on this device. It opens in its own window and works offline.</Callout>
      ) : install.canPrompt ? (
        <>
          <p className="mb-4 text-[14px] leading-relaxed text-white/70">
            Add SpendNote to your home screen or desktop. It opens in its own window and works offline.
          </p>
          <Button variant="white" icon={Download} onClick={() => promptInstall()}>
            Install SpendNote
          </Button>
        </>
      ) : install.isIOS ? (
        <p className="flex gap-3 text-[14px] leading-relaxed text-white/70">
          <Smartphone size={20} strokeWidth={1.6} aria-hidden className="mt-0.5 shrink-0" />
          In Safari, tap the Share button, then “Add to Home Screen”.
        </p>
      ) : (
        <p className="text-[14px] leading-relaxed text-white/70">
          Your browser hasn’t offered to install SpendNote. In Chrome or Edge, look for “Install” in the address bar or menu. SpendNote
          works just as well in a browser tab, and it works offline once it has loaded.
        </p>
      )}
    </Card>
  );
}

function DataSection() {
  const { data, mode, replaceAll, eraseAll } = useData();
  const auth = useAuth();
  const { confirm, toast } = useUi();
  const fileRef = useRef<HTMLInputElement>(null);
  const [restoreErrors, setRestoreErrors] = useState<string[] | null>(null);
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [usage, setUsage] = useState<string | null>(null);
  const [lastBackup, setLastBackup] = useState<string | null>(() => {
    try {
      return localStorage.getItem(LAST_BACKUP_KEY);
    } catch {
      return null;
    }
  });
  const demo = mode === 'demo';
  const stamp = todayISO();

  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null));
    navigator.storage
      ?.estimate?.()
      .then((e) => e.usage !== undefined && setUsage(`${Math.max(1, Math.round(e.usage / 1024))} KB used`))
      .catch(() => undefined);
  }, []);

  const exportJson = () => {
    download(
      `spendnote-${demo ? 'demo-' : ''}backup-${stamp}.json`,
      JSON.stringify(makeBackup(data, demo), null, 2),
      'application/json',
    );
    if (!demo) {
      const now = new Date().toISOString();
      try {
        localStorage.setItem(LAST_BACKUP_KEY, now);
      } catch {
        /* ignore */
      }
      setLastBackup(now);
    }
    toast('Backup downloaded.');
  };

  const exportCsv = () => {
    download(`spendnote-${demo ? 'demo-' : ''}transactions-${stamp}.csv`, '﻿' + transactionsToCsv(data), 'text/csv;charset=utf-8');
    toast('CSV downloaded.');
  };

  const onFile = async (file: File) => {
    setRestoreErrors(null);
    if (file.size > 20 * 1024 * 1024) {
      setRestoreErrors(['That file is too large to be a SpendNote backup.']);
      return;
    }
    const result = parseBackup(await file.text());
    if (!result.ok) {
      setRestoreErrors(result.errors);
      return;
    }
    const d = result.data;
    const ok = await confirm({
      title: 'Replace your data with this backup?',
      body: (
        <>
          The backup{result.exportedAt ? ` from ${formatTimestamp(result.exportedAt)}` : ''} has {d.transactions.length} entries and{' '}
          {d.accounts.length} accounts. It will <strong className="text-white">replace</strong> your current {data.transactions.length} entries.
          This can’t be undone, so export a backup first if you might need your current data.
        </>
      ),
      confirmLabel: 'Replace my data',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await replaceAll(d);
      toast(`Restored ${d.transactions.length} entries.`);
    } catch (e) {
      toast(`Restore failed: ${(e as Error).message}. Your data wasn’t changed.`, { tone: 'error' });
    }
  };

  return (
    <Card aria-labelledby="set-data">
      <SectionHeader id="set-data" title="Your data" />
      <div className="flex gap-3 rounded-[20px] border border-white/[0.07] bg-white/[0.03] p-4">
        <HardDrive size={20} strokeWidth={1.6} aria-hidden className="mt-0.5 shrink-0 text-white/70" />
        <div className="text-[14px] leading-relaxed text-white/75">
          <p>
            {demo
              ? 'Demo data is stored only in this browser and is deleted when you exit the demo.'
              : auth.status === 'unconfigured'
                ? 'This copy of SpendNote isn’t connected to an account, so everything is stored only on this device, in this browser. Clearing site data deletes it, so export a backup now and then.'
                : 'Your records are saved to your SpendNote account, and a copy is kept on this device so the app works offline. Changes made offline are uploaded when you reconnect.'}
          </p>
          <p className="mt-2 text-white/60">
            {persisted === true && 'This browser has agreed to keep your data. '}
            {persisted === false && 'The browser may clear this data if the device runs low on space. '}
            {usage && `${usage}.`}
          </p>
          {persisted === false && navigator.storage?.persist && (
            <Button
              size="sm"
              variant="secondary"
              className="mt-3"
              onClick={async () => {
                const ok = await navigator.storage.persist();
                setPersisted(ok);
                toast(ok ? 'The browser will keep your data.' : 'The browser declined. Installing the app often helps.');
              }}
            >
              Ask the browser to keep it
            </Button>
          )}
        </div>
      </div>

      <div className="mt-5 grid gap-2.5 sm:grid-cols-2">
        <Button icon={FileJson} onClick={exportJson} className="justify-start">
          Export backup (JSON)
        </Button>
        <Button icon={FileSpreadsheet} onClick={exportCsv} className="justify-start" disabled={data.transactions.length === 0}>
          Export transactions (CSV)
        </Button>
        <Button icon={Upload} onClick={() => fileRef.current?.click()} className="justify-start" disabled={demo}>
          Restore from backup
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) onFile(file);
          }}
        />
        {!demo && (
          <Button
            variant="danger"
            icon={Trash2}
            className="justify-start"
            onClick={async () => {
              const ok = await confirm({
                title: 'Delete all your records?',
                body: `This permanently deletes ${data.transactions.length} entries, ${data.accounts.length} accounts and your settings${auth.status === 'signed-in' ? ' from your account, on every device' : ' from this device'}. Export a backup first if you might need them.`,
                confirmLabel: 'Delete everything',
                tone: 'danger',
              });
              if (ok) {
                await eraseAll();
                toast('All records deleted.');
              }
            }}
          >
            Delete all records
          </Button>
        )}
      </div>
      <p className="mt-3 text-[13px] text-white/55">
        {demo
          ? 'You’re in demo mode. Exports are labelled as demo, and restoring is turned off so sample data can’t mix with your own.'
          : lastBackup
            ? `Last backup: ${formatTimestamp(lastBackup)}.`
            : 'You haven’t exported a backup from this device yet.'}
      </p>
      {restoreErrors && (
        <Callout tone="error" title="This backup can’t be restored" className="mt-4">
          <ul className="list-disc space-y-1 pl-4">
            {restoreErrors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
          <p className="mt-2">Nothing was changed.</p>
        </Callout>
      )}
    </Card>
  );
}

function DemoSection() {
  const { mode, enterDemo, exitDemo } = useData();
  const { toast, confirm } = useUi();
  const demo = mode === 'demo';
  return (
    <Card aria-labelledby="set-demo">
      <SectionHeader id="set-demo" title="Demo mode" />
      <p className="mb-4 text-[14px] leading-relaxed text-white/70">
        {demo
          ? 'You’re exploring sample data. It’s stored separately and deleted when you exit.'
          : 'Try SpendNote with realistic sample entries. The demo is kept completely separate from your own records.'}
      </p>
      <div className="flex flex-wrap gap-2">
        {demo ? (
          <>
            <Button variant="white" onClick={() => exitDemo().then(() => toast('Back to your own records.'))}>
              Exit demo
            </Button>
            <Button
              variant="secondary"
              onClick={async () => {
                if (await confirm({ title: 'Reset the demo?', body: 'Your changes to the sample data will be undone.', confirmLabel: 'Reset demo' })) {
                  await enterDemo();
                  toast('Demo reset.');
                }
              }}
            >
              Reset demo data
            </Button>
          </>
        ) : (
          <Button variant="secondary" icon={Play} onClick={() => enterDemo()}>
            Explore demo
          </Button>
        )}
      </div>
    </Card>
  );
}

export function Settings() {
  return (
    <>
      <header className="mb-6 md:mb-8">
        <h1 className="text-[28px] font-semibold tracking-[-0.03em] md:text-[32px]">Settings</h1>
        <p className="mt-1 text-[15px] text-white/60">Currency, accounts, reminders and your data.</p>
      </header>
      <div className={cx('grid grid-cols-1 items-start gap-5 lg:grid-cols-2 lg:gap-6')}>
        <div className="grid grid-cols-1 gap-5 lg:gap-6">
          <AccountSection />
          <CurrencySection />
          <AccountsSection />
          <RemindersSection />
          <InstallSection />
        </div>
        <div className="grid grid-cols-1 gap-5 lg:gap-6">
          <DataSection />
          <CategoriesSection />
          <DemoSection />
          <p className="px-2 text-center text-[13px] text-white/45">SpendNote by O.B (Osei-Bonsu) · Works offline · No ads or tracking</p>
        </div>
      </div>
    </>
  );
}
