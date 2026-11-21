import { Check, Copy, Download, EllipsisVertical, Menu, MonitorDown, Share, SquarePlus } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { LogoMark } from '../components/icons';
import { Button, cx } from '../components/ui';
import { promptInstall, useInstall } from '../state/install';
import { Illustration } from './FirstRun';

type Corner = 'bottom-right' | 'bottom-center' | 'bottom-left' | 'top-right' | 'top-left';

interface Guide {
  /** Where the browser button is, so the arrow can point at it. Null when there's nothing to point at. */
  pointer: { at: Corner; label: ReactNode } | null;
  steps: ReactNode[];
  note?: ReactNode;
}

/** A small look-alike of the browser button, so people recognise what to tap. */
const Tap = ({ icon: Icon, children }: { icon?: typeof Share; children?: ReactNode }) => (
  <span className="mx-0.5 inline-flex translate-y-[-1px] items-center gap-1.5 whitespace-nowrap rounded-full bg-white px-2.5 py-0.5 text-[15px] font-semibold text-black align-middle">
    {Icon && <Icon size={16} strokeWidth={2.2} aria-hidden />}
    {children}
  </span>
);

const B = ({ children }: { children: ReactNode }) => <span className="font-semibold text-white">{children}</span>;

/** Works out what this person has to tap, and where that button is on their screen. */
function guideFor(install: ReturnType<typeof useInstall>): Guide {
  const openIt = <>Open <B>SpendNote</B> from your home screen and sign in.</>;
  const addToHome = (
    <>
      Scroll down and tap <Tap icon={SquarePlus}>Add to Home Screen</Tap>
    </>
  );

  if (install.device === 'iphone' && install.browser === 'safari') {
    if ((install.safariMajor ?? 0) >= 26) {
      // iOS 26 (iPhone 17), default "Compact" layout: [‹] [≡ address ⟳] [tabs]. Share is in the ≡ menu.
      return {
        pointer: { at: 'bottom-left', label: <>Tap <Menu size={18} strokeWidth={2.6} className="inline" aria-label="the menu button" /> here</> },
        steps: [
          <>Tap <Tap icon={Menu} /> at the left of the address bar.</>,
          <>Tap <Tap icon={Share}>Share</Tap></>,
          <>Tap <Tap icon={SquarePlus}>Add to Home Screen</Tap> (scroll down if needed).</>,
          <>Keep <B>Open as Web App</B> on, then tap <Tap>Add</Tap></>,
          <>Open <B>SpendNote</B> from your home screen.</>,
        ],
        note: <>No <B>≡</B>? Tap <B>⋯</B> or the <B>Share</B> button in your toolbar instead.</>,
      };
    }
    return {
      pointer: { at: 'bottom-center', label: <>Tap <Share size={17} strokeWidth={2.4} className="inline" aria-label="Share" /> Share</> },
      steps: [
        <>Tap <Tap icon={Share}>Share</Tap> in the bar at the bottom.</>,
        addToHome,
        <>Tap <Tap>Add</Tap></>,
        openIt,
      ],
    };
  }

  if (install.device === 'ipad' && install.browser === 'safari') {
    return {
      pointer: { at: 'top-right', label: <>Tap <Share size={17} strokeWidth={2.4} className="inline" aria-label="Share" /> Share</> },
      steps: [
        <>Tap <Tap icon={Share}>Share</Tap> at the top right.</>,
        addToHome,
        <>Keep <B>Open as Web App</B> on if you see it, then tap <Tap>Add</Tap></>,
        openIt,
      ],
    };
  }

  if (install.platform === 'ios') {
    // Chrome, Edge or Firefox on iPhone/iPad can also add web apps through Share.
    const firefox = install.browser === 'firefox';
    return {
      pointer: firefox
        ? { at: 'bottom-right', label: <>Tap <Menu size={17} strokeWidth={2.4} className="inline" aria-label="menu" /> menu</> }
        : { at: 'top-right', label: <>Tap <Share size={17} strokeWidth={2.4} className="inline" aria-label="Share" /> Share</> },
      steps: [
        firefox ? <>Tap the menu <Tap icon={Menu} />, then <Tap icon={Share}>Share</Tap></> : <>Tap <Tap icon={Share}>Share</Tap> in the address bar.</>,
        addToHome,
        <>Tap <Tap>Add</Tap></>,
        openIt,
      ],
    };
  }

  if (install.platform === 'android') {
    if (install.browser === 'samsung') {
      return {
        pointer: { at: 'bottom-right', label: <>Tap <Menu size={17} strokeWidth={2.4} className="inline" aria-label="menu" /> menu</> },
        steps: [
          <>Tap the menu <Tap icon={Menu} /> at the bottom right.</>,
          <>Tap <Tap icon={SquarePlus}>Add page to</Tap>, then <B>Home screen</B>.</>,
          openIt,
        ],
      };
    }
    return {
      pointer: { at: 'top-right', label: <>Tap <EllipsisVertical size={17} strokeWidth={2.6} className="inline" aria-label="menu" /> here</> },
      steps: [
        <>Tap the browser menu <Tap icon={EllipsisVertical} /> at the top right.</>,
        <>Tap <Tap icon={Download}>Install app</Tap> (or <B>Add to Home screen</B>), then <B>Install</B>.</>,
        openIt,
      ],
    };
  }

  if (install.browser === 'safari') {
    return {
      pointer: { at: 'top-left', label: <>Use the <B>File</B> menu</> },
      steps: [
        <>In the menu bar at the top of your screen, choose <B>File</B> → <Tap icon={SquarePlus}>Add to Dock</Tap></>,
        <>Open <B>SpendNote</B> from your Dock and sign in.</>,
      ],
    };
  }

  return {
    pointer: { at: 'top-right', label: <>Click the install icon in the address bar</> },
    steps: [
      <>Click the install icon <Tap icon={MonitorDown} /> at the right end of the address bar, or open the browser menu <Tap icon={EllipsisVertical} /> and choose <B>Install SpendNote</B>.</>,
      <>SpendNote opens in its own window. Sign in there.</>,
    ],
  };
}

/** A bouncing arrow pinned to the screen edge, pointing at the browser button to tap. */
function Pointer({ at, label }: { at: Corner; label: ReactNode }) {
  const up = at.startsWith('top');
  const pos = {
    'bottom-right': 'right-3 bottom-[calc(env(safe-area-inset-bottom)+6px)] items-end',
    'bottom-center': 'left-1/2 -translate-x-1/2 bottom-[calc(env(safe-area-inset-bottom)+6px)] items-center',
    // Safari 26 on iPhone: ≡ is just right of the back button, about 115pt from the left edge.
    'bottom-left': 'left-[92px] bottom-[calc(env(safe-area-inset-bottom)+6px)] items-start',
    'top-right': 'right-3 top-[calc(env(safe-area-inset-top)+6px)] items-end sm:right-24',
    'top-left': 'left-3 top-[calc(env(safe-area-inset-top)+6px)] items-start',
  }[at];
  const arrow = (
    <svg
      width="44"
      height="56"
      viewBox="0 0 44 56"
      aria-hidden
      className={cx('drop-shadow-[0_0_14px_rgba(255,106,26,0.7)]', up && 'rotate-180', at === 'bottom-right' || at === 'top-right' ? 'mr-1' : '')}
    >
      <path d="M22 2v42" stroke="#ff8a47" strokeWidth="6" strokeLinecap="round" />
      <path d="M6 30l16 18 16-18" fill="none" stroke="#ff8a47" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  return (
    <>
    <div
      aria-hidden
      className={cx(
        'pointer-events-none fixed inset-x-0 z-40 h-[150px]',
        up
          ? 'top-0 bg-[linear-gradient(0deg,rgba(10,10,10,0)_0%,rgba(10,10,10,0.92)_55%,#0a0a0a_100%)]'
          : 'bottom-0 bg-[linear-gradient(180deg,rgba(10,10,10,0)_0%,rgba(10,10,10,0.92)_55%,#0a0a0a_100%)]',
      )}
    />
    <div
      data-testid="install-pointer"
      data-at={at}
      className={cx('pointer-events-none fixed z-50 flex flex-col gap-1.5', pos, up ? 'animate-[nudge-up_1.1s_ease-in-out_infinite]' : 'animate-[nudge-down_1.1s_ease-in-out_infinite]')}
    >
      {up && arrow}
      <span className="btn-flame rounded-2xl px-3.5 py-2 text-[15px] font-semibold whitespace-nowrap">{label}</span>
      {!up && arrow}
    </div>
    </>
  );
}

function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="mt-5 max-w-[440px] space-y-3">
      {items.map((item, i) => (
        <li key={i} className="flex gap-3 text-[16px] leading-[1.6] text-white/80">
          <span
            className={cx(
              'tnum mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[14px] font-semibold',
              i === 0 ? 'bg-flame-500 text-white' : 'bg-white/[0.08] text-white',
            )}
          >
            {i + 1}
          </span>
          <span>{item}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Shown instead of the app in a normal browser tab: SpendNote has to be installed and opened as an
 * app, before anyone can sign in. It points at the exact browser button to tap for this device.
 */
export function InstallGate() {
  const install = useInstall();
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const canInstallHere = install.browser !== 'in-app' && !(install.platform === 'desktop' && install.browser === 'firefox');
  const guide = guideFor(install);
  const showPointer = canInstallHere && !install.canPrompt && !install.justInstalled && guide.pointer;

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
    <p className="mt-4 max-w-[460px] text-[17px] leading-relaxed text-white/70 sm:mt-5">
      SpendNote runs as an app. Install it first, then open it from your home screen to sign in.
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
          Open it from your home screen or your list of apps to sign in. You can close this browser tab.
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
  } else {
    body = (
      <>
        <div className="hidden sm:block">{intro}</div>
        <Steps items={guide.steps} />
        {guide.note && <p className="mt-3 max-w-[440px] text-[14px] leading-relaxed text-white/60">{guide.note}</p>}
      </>
    );
  }

  const pointerAt = showPointer ? guide.pointer!.at : null;
  return (
    <main
      id="main"
      className={cx(
        'relative min-h-dvh overflow-hidden px-5',
        // Leave room for the arrow so it never covers the instructions.
        pointerAt?.startsWith('top') ? 'pt-[calc(env(safe-area-inset-top)+120px)]' : 'pt-[max(28px,env(safe-area-inset-top))]',
        pointerAt?.startsWith('bottom') ? 'pb-[calc(env(safe-area-inset-bottom)+150px)]' : 'pb-[max(32px,env(safe-area-inset-bottom))]',
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-40 left-1/2 h-[420px] w-[720px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(255,106,26,0.22),transparent)]"
      />
      <div className="relative mx-auto grid max-w-[1040px] grid-cols-1 items-start gap-10 sm:min-h-[calc(100dvh-160px)] sm:items-center lg:grid-cols-2 lg:gap-16">
        <div className="order-2 lg:order-1">
          <div className="flex items-center gap-3">
            <LogoMark size={44} />
            <span className="text-[19px] font-semibold tracking-[-0.02em]">SpendNote</span>
          </div>
          <h1 className="mt-5 text-[clamp(2rem,8vw,3.3rem)] font-semibold leading-[1.04] tracking-[-0.035em] sm:mt-8">
            {install.justInstalled ? 'Open SpendNote' : 'Install SpendNote to continue'}
          </h1>
          {body}
          {!install.justInstalled && (
            <p className="mt-4 max-w-[420px] text-[14px] leading-relaxed text-white/55 sm:mt-6">
              Already installed? Open SpendNote from your home screen or your list of apps.
            </p>
          )}
        </div>
        <div className="order-1 hidden sm:block lg:order-2">
          <Illustration />
        </div>
      </div>
      {showPointer && <Pointer at={guide.pointer!.at} label={guide.pointer!.label} />}
    </main>
  );
}
