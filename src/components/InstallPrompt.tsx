import { Download, Share, SquarePlus, X } from 'lucide-react';
import { useState } from 'react';
import { promptInstall, useInstall } from '../state/install';
import { useUi } from '../state/ui';
import { LogoMark } from './icons';
import { Button, cx, IconButton } from './ui';

const DISMISS_KEY = 'spendnote.installDismissed';

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}

/** iPhone/iPad Safari has no install prompt, so explain the two taps instead. */
function IosSteps({ className }: { className?: string }) {
  return (
    <p className={cx('flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[14px] leading-snug text-white/70', className)}>
      <span>To install, tap</span>
      <span className="inline-flex items-center gap-1 font-medium text-white">
        <Share size={15} strokeWidth={1.8} aria-hidden /> Share
      </span>
      <span>then</span>
      <span className="inline-flex items-center gap-1 font-medium text-white">
        <SquarePlus size={15} strokeWidth={1.8} aria-hidden /> Add to Home Screen
      </span>
    </p>
  );
}

function useInstallAction() {
  const { toast } = useUi();
  return async () => {
    const outcome = await promptInstall();
    if (outcome === 'accepted') toast('Installing SpendNote. You’ll find it with your other apps.');
  };
}

/** For the sign-in and welcome screens: a plain button, or the iPhone steps. */
export function InstallButton({ className }: { className?: string }) {
  const install = useInstall();
  const run = useInstallAction();
  if (install.installed) return null;
  if (install.canPrompt) {
    return (
      <Button variant="ghost" size="lg" icon={Download} block className={className} onClick={() => void run()}>
        Install the app
      </Button>
    );
  }
  if (install.isIOS) return <IosSteps className={cx('justify-center', className)} />;
  return null;
}

/** For the Overview: a card you can dismiss, shown only where installing is possible. */
export function InstallBanner() {
  const install = useInstall();
  const run = useInstallAction();
  const [dismissed, setDismissed] = useState(readDismissed);
  if (install.installed || dismissed || (!install.canPrompt && !install.isIOS)) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* storage blocked */
    }
  };

  return (
    <section
      aria-labelledby="install-title"
      className="mb-6 flex animate-rise items-start gap-3.5 rounded-[24px] border border-white/[0.08] bg-[linear-gradient(110deg,#1b100a_0%,#141414_70%)] p-4 sm:p-5"
    >
      <LogoMark size={44} />
      <div className="min-w-0 flex-1">
        <h2 id="install-title" className="text-[16px] font-semibold text-white">
          Install SpendNote
        </h2>
        {install.canPrompt ? (
          <p className="mt-0.5 text-[14px] leading-snug text-white/65">
            Open it from your home screen or desktop like any other app. It works offline too.
          </p>
        ) : (
          <IosSteps className="mt-1" />
        )}
        {install.canPrompt && (
          <Button variant="white" size="sm" icon={Download} className="mt-3" onClick={() => void run()}>
            Install
          </Button>
        )}
      </div>
      <IconButton icon={X} label="Dismiss install suggestion" size={36} tone="ghost" onClick={dismiss} />
    </section>
  );
}
