import { Check, Copy, Download, EllipsisVertical, MonitorDown, Share, SquarePlus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { LogoMark } from '../components/icons';
import { Button } from '../components/ui';
import { promptInstall, useInstall } from '../state/install';
import { Illustration } from './FirstRun';

function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="mt-5 max-w-[420px] space-y-3">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3 text-[16px] leading-snug text-white/85">
          <span className="tnum inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-[14px] font-semibold text-white">
            {i + 1}
          </span>
          <span className="pt-0.5">{item}</span>
        </li>
      ))}
    </ol>
  );
}

const Key = ({ icon: Icon, children }: { icon?: typeof Share; children: ReactNode }) => (
  <span className="inline-flex items-center gap-1 whitespace-nowrap font-semibold text-white">
    {Icon && <Icon size={16} strokeWidth={1.9} aria-hidden />}
    {children}
  </span>
);

/**
 * Shown instead of the app in a normal browser tab: SpendNote has to be installed and opened as an app.
 */
export function InstallGate() {
  const install = useInstall();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const canInstallHere = install.browser !== 'in-app' && !(install.platform === 'desktop' && install.browser === 'firefox');

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(location.origin + '/');
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      /* clipboard blocked: the link is shown on screen to copy by hand */
    }
  };

  const intro = (
    <p className="mt-5 max-w-[460px] text-[17px] leading-relaxed text-white/70">
      SpendNote runs as an app on your phone or computer. Install it once and open it from your home screen. It works offline and
      keeps your records safe.
    </p>
  );

  let body: ReactNode;
  if (install.justInstalled) {
    body = (
      <>
        <p className="mt-5 flex items-center gap-2 text-[17px] font-semibold text-mint-300">
          <Check size={20} strokeWidth={2} aria-hidden /> SpendNote is installed
        </p>
        <p className="mt-2 max-w-[460px] text-[16px] leading-relaxed text-white/70">
          Open it from your home screen or your list of apps to continue. You can close this browser tab.
        </p>
      </>
    );
  } else if (!canInstallHere) {
    body = (
      <>
        <p className="mt-5 max-w-[460px] text-[16px] leading-relaxed text-white/70">
          {install.browser === 'in-app'
            ? 'You’re viewing this inside another app, which can’t install apps.'
            : 'This browser can’t install apps.'}{' '}
          Open this link in {install.platform === 'ios' ? 'Safari' : install.platform === 'android' ? 'Chrome' : 'Chrome, Edge or Safari'}, then install SpendNote from there.
        </p>
        <div className="mt-5 flex max-w-[420px] items-center gap-2 rounded-2xl border border-white/[0.09] bg-white/[0.04] p-2 pl-4">
          <span className="min-w-0 flex-1 truncate text-[15px] text-white">{location.host}</span>
          <Button size="sm" variant="white" icon={copied ? Check : Copy} onClick={() => void copyLink()}>
            {copied ? 'Copied' : 'Copy link'}
          </Button>
        </div>
      </>
    );
  } else if (install.canPrompt) {
    body = (
      <>
        {intro}
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await promptInstall();
            setBusy(false);
          }}
          className="add-slab mt-8 flex h-[68px] w-full max-w-[420px] items-center justify-center gap-3 rounded-[26px] text-[18px] font-semibold text-white disabled:opacity-60"
        >
          <Download size={24} strokeWidth={1.7} aria-hidden />
          Install SpendNote
        </button>
      </>
    );
  } else if (install.platform === 'ios') {
    body = (
      <>
      {intro}
      <Steps
        items={[
          <>Tap <Key icon={Share}>Share</Key>{install.browser === 'safari' ? ' at the bottom of the screen' : ' in the address bar'}.</>,
          <>Choose <Key icon={SquarePlus}>Add to Home Screen</Key>, then <Key>Add</Key>.</>,
          <>Open <Key>SpendNote</Key> from your home screen.</>,
        ]}
      />
      </>
    );
  } else if (install.platform === 'android') {
    body = (
      <>
      {intro}
      <Steps
        items={[
          <>Tap the browser menu <Key icon={EllipsisVertical}>⋮</Key>.</>,
          <>Choose <Key>Install app</Key> or <Key>Add to Home screen</Key>.</>,
          <>Open <Key>SpendNote</Key> from your home screen.</>,
        ]}
      />
      </>
    );
  } else if (install.browser === 'safari') {
    body = (
      <>
      {intro}
      <Steps
        items={[
          <>In the menu bar, choose <Key>File</Key> → <Key>Add to Dock</Key>.</>,
          <>Open <Key>SpendNote</Key> from your Dock.</>,
        ]}
      />
      </>
    );
  } else {
    body = (
      <>
      {intro}
      <Steps
        items={[
          <>Click the install icon <Key icon={MonitorDown}>Install</Key> at the right end of the address bar, or open the browser menu <Key icon={EllipsisVertical}>⋮</Key> and choose <Key>Install SpendNote</Key>.</>,
          <>SpendNote opens in its own window. Use it from there.</>,
        ]}
      />
      </>
    );
  }

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
          <h1 className="mt-8 text-[clamp(2.2rem,8.5vw,3.3rem)] font-semibold leading-[1.04] tracking-[-0.035em]">
            {install.justInstalled ? 'Open SpendNote' : 'Install SpendNote to continue'}
          </h1>
          {body}
          {!install.justInstalled && (
            <p className="mt-8 max-w-[420px] text-[14px] leading-relaxed text-white/55">
              Already installed? Open SpendNote from your home screen or your list of apps.
            </p>
          )}
        </div>
        <div className="order-1 hidden sm:block lg:order-2">
          <Illustration />
        </div>
      </div>
    </main>
  );
}
