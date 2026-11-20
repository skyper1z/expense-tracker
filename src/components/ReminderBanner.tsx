import { Bell } from 'lucide-react';
import { useEffect, useState } from 'react';
import { needsAttention } from '../lib/calc';
import { isReminderDue, nextOccurrence } from '../lib/reminders';
import { useData } from '../state/data';
import { navigate } from '../state/router';
import { Button } from './ui';

/** Re-checks at the next scheduled reminder time while the app stays open. */
export function useReminderDue(): boolean {
  const { data, ready } = useData();
  const [, setTick] = useState(0);
  const r = data.settings.reminder;
  useEffect(() => {
    if (!r.enabled) return;
    const ms = Math.min(nextOccurrence(r, new Date()).getTime() - Date.now() + 1000, 2 ** 31 - 1);
    const t = window.setTimeout(() => setTick((n) => n + 1), Math.max(1000, ms));
    return () => window.clearTimeout(t);
  }, [r]);
  return ready && isReminderDue(data.settings, new Date());
}

export function ReminderBanner({ onReviewScreen = false }: { onReviewScreen?: boolean }) {
  const due = useReminderDue();
  const { data, updateSettings } = useData();
  if (!due) return null;
  const n = data.transactions.filter(needsAttention).length;
  const ack = () => updateSettings({ reminderAckAt: new Date().toISOString() });
  return (
    <div className="mb-6 flex animate-rise flex-col gap-4 rounded-[24px] border border-flame-400/25 bg-[linear-gradient(110deg,#1b100a_0%,#141414_70%)] p-4 sm:flex-row sm:items-center sm:p-5">
      <div className="flex min-w-0 flex-1 items-start gap-3.5">
        <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-flame-500/15 text-flame-300">
          <Bell size={20} strokeWidth={1.7} aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-[16px] font-semibold text-white">Time for your weekly review</p>
          <p className="mt-0.5 text-[14px] leading-snug text-white/65">
            {n > 0
              ? `${n} ${n === 1 ? 'expense needs' : 'expenses need'} a note. A quick look now keeps your totals meaningful.`
              : 'Everything has a note. Take a quick look at this week’s spending.'}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        {!onReviewScreen && (
          <Button
            variant="white"
            size="sm"
            onClick={() => {
              ack();
              navigate('review');
            }}
          >
            Review now
          </Button>
        )}
        <Button variant="secondary" size="sm" onClick={ack}>
          {onReviewScreen ? 'Done' : 'Dismiss'}
        </Button>
      </div>
    </div>
  );
}
