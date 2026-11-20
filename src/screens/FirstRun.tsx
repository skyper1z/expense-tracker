import { CirclePlus, Play, ShoppingBasket } from 'lucide-react';
import { useState } from 'react';
import { LogoMark } from '../components/icons';
import { Button } from '../components/ui';
import { useAuth } from '../state/auth';
import { useData } from '../state/data';
import { navigate } from '../state/router';
import { useUi } from '../state/ui';

/** A tiny, static echo of the real summary card, showing that each expense carries a note. */
export function Illustration() {
  return (
    <div aria-hidden className="relative mx-auto w-full max-w-[300px] select-none sm:max-w-[340px]">
      <div className="summary-card relative z-10 rounded-[30px] border border-white/[0.06] px-5 pb-6 pt-5">
        <p className="text-center text-[13px] font-medium text-white/80">Total spent</p>
        <p className="tnum mt-1 text-center text-[42px] font-[430] leading-none tracking-[-0.045em]">
          <span className="mr-0.5 align-[0.42em] text-[0.6em] font-medium">GH₵</span>120.00
        </p>
        <div className="mt-5 rounded-[20px] border border-white/[0.07] bg-[linear-gradient(105deg,#171717_30%,rgba(245,165,36,0.16)_100%)] p-3.5">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#F5A524] text-[#121212]">
              <ShoppingBasket size={17} strokeWidth={1.9} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex justify-between text-[14px]">
                <span className="font-medium">Food & groceries</span>
                <span className="tnum font-semibold">GH₵120.00</span>
              </div>
              <p className="text-[12px] text-white/60">Today · Cash</p>
            </div>
          </div>
          <p className="mt-2.5 text-[13px] leading-snug text-white/85">“Bought vegetables and other things for the week.”</p>
        </div>
      </div>
      <div className="add-slab relative z-0 mx-2.5 -mt-10 h-[78px] rounded-b-[30px]" />
    </div>
  );
}

export function FirstRun() {
  const { updateSettings, enterDemo } = useData();
  const auth = useAuth();
  const { openSheet } = useUi();
  const [busy, setBusy] = useState(false);

  return (
    <main
      id="main"
      className="relative min-h-dvh overflow-hidden px-5 pb-[max(32px,env(safe-area-inset-bottom))] pt-[max(28px,env(safe-area-inset-top))]"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-40 left-1/2 h-[420px] w-[720px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(255,106,26,0.22),transparent)]"
      />
      <div className="relative mx-auto grid min-h-[calc(100dvh-80px)] max-w-[1040px] items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <div className="order-2 lg:order-1">
          <div className="flex items-center gap-3">
            <LogoMark size={44} />
            <span className="text-[19px] font-semibold tracking-[-0.02em]">SpendNote</span>
          </div>
          <h1 className="mt-8 text-[clamp(2.4rem,9vw,3.6rem)] font-semibold leading-[1.02] tracking-[-0.04em]">
            Know where your money goes.
          </h1>
          <p className="mt-5 max-w-[460px] text-[17px] leading-relaxed text-white/70">
            Record what you spend and add a short note about what each expense was for. SpendNote adds up your weeks and months, so
            you can see where it all went.
          </p>
          <div className="mt-9 max-w-[420px] space-y-3">
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await updateSettings({ onboarded: true });
                openSheet({ kind: 'tx-new' });
              }}
              className="add-slab flex h-[68px] w-full items-center justify-center gap-3 rounded-[26px] text-[18px] font-semibold text-white disabled:opacity-60"
            >
              <CirclePlus size={26} strokeWidth={1.5} aria-hidden />
              Add my first expense
            </button>
            <Button
              variant="secondary"
              size="lg"
              block
              icon={Play}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await enterDemo();
              }}
            >
              Explore demo
            </Button>
          </div>
          <p className="mt-6 text-[14px] text-white/55">
            {auth.status === 'signed-in' ? 'Your records are saved to your account and also work offline.' : 'No sign-up. Your records stay on this device.'}{' '}
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await updateSettings({ onboarded: true });
                navigate('settings');
              }}
              className="font-medium text-white/80 underline decoration-white/30 underline-offset-4 hover:text-white"
            >
              Restore from a backup
            </button>
          </p>
        </div>
        <div className="order-1 lg:order-2">
          <Illustration />
        </div>
      </div>
    </main>
  );
}
