import { useEffect, useMemo, useRef, useState } from 'react';
import type { DayTotal } from '../lib/calc';
import { formatDayHeading, WEEKDAYS } from '../lib/dates';
import type { PeriodKind } from '../lib/dates';
import { cx } from './ui';

/**
 * Small daily spending chart for the summary card. Tap or drag across it, or
 * focus it and use the arrow keys, to read any day's total.
 */
export function TrendBars({
  series,
  today,
  kind,
  format,
}: {
  series: DayTotal[];
  today: string;
  kind: PeriodKind;
  format: (minor: number) => string;
}) {
  const max = Math.max(0, ...series.map((d) => d.amount));
  const todayIdx = series.findIndex((d) => d.date === today);
  const peakIdx = max > 0 ? series.findIndex((d) => d.amount === max) : -1;
  const defaultIdx = todayIdx >= 0 ? todayIdx : peakIdx;
  const [sel, setSel] = useState<number | null>(null);
  const area = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  // Reset the selection whenever the period changes.
  const key = series[0]?.date;
  useEffect(() => setSel(null), [key]);

  const idx = sel ?? defaultIdx;
  const caption = useMemo(() => {
    if (max === 0) return kind === 'week' ? 'No spending recorded this week' : 'No spending recorded this month';
    if (idx < 0) return '';
    const d = series[idx];
    const label = formatDayHeading(d.date, today);
    const prefix = sel === null && idx === peakIdx && idx !== todayIdx ? 'Biggest day · ' : '';
    return `${prefix}${label} · ${format(d.amount)}`;
  }, [idx, sel, series, today, max, peakIdx, todayIdx, kind, format]);

  const pick = (clientX: number) => {
    const el = area.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const i = Math.floor(((clientX - r.left) / r.width) * series.length);
    setSel(Math.max(0, Math.min(series.length - 1, i)));
  };

  const labelFor = (d: DayTotal, i: number) => {
    if (kind === 'week') return WEEKDAYS[i].charAt(0);
    const day = Number(d.date.slice(8));
    return [1, 8, 15, 22, 29].includes(day) ? String(day) : '';
  };

  return (
    <div>
      <p aria-live="polite" className="tnum mb-3 min-h-[20px] text-center text-[14px] font-medium text-white/80">
        {caption}
      </p>
      <div
        ref={area}
        tabIndex={0}
        role="group"
        aria-label="Daily spending chart. Use the left and right arrow keys to read each day."
        onKeyDown={(e) => {
          const cur = idx < 0 ? 0 : idx;
          if (e.key === 'ArrowLeft') setSel(Math.max(0, cur - 1));
          else if (e.key === 'ArrowRight') setSel(Math.min(series.length - 1, cur + 1));
          else if (e.key === 'Home') setSel(0);
          else if (e.key === 'End') setSel(series.length - 1);
          else return;
          e.preventDefault();
        }}
        onPointerDown={(e) => {
          dragging.current = true;
          (e.target as Element).setPointerCapture?.(e.pointerId);
          pick(e.clientX);
        }}
        onPointerMove={(e) => dragging.current && pick(e.clientX)}
        onPointerUp={() => (dragging.current = false)}
        onPointerCancel={() => (dragging.current = false)}
        className="touch-pan-y select-none rounded-xl outline-offset-4"
      >
        <div className={cx('flex h-16 items-end', kind === 'week' ? 'gap-2.5 px-1' : 'gap-[3px]')}>
          {series.map((d, i) => {
            const h = max > 0 ? Math.max((d.amount / max) * 100, d.amount > 0 ? 7 : 0) : 0;
            const active = i === idx && max > 0;
            return (
              <div key={d.date} className="flex h-full flex-1 items-end justify-center">
                <div
                  className={cx(
                    'w-full transition-[height,background-color] duration-300',
                    kind === 'week' ? 'max-w-[30px] rounded-[7px]' : 'rounded-[3px]',
                    d.amount === 0
                      ? 'h-[4px] bg-white/[0.12]'
                      : active
                        ? 'bg-[linear-gradient(180deg,#ffa066_0%,#ff6a1a_100%)] shadow-[0_0_18px_-2px_rgba(255,106,26,0.55)]'
                        : 'bg-white/[0.32]',
                  )}
                  style={d.amount > 0 ? { height: `${h}%` } : undefined}
                />
              </div>
            );
          })}
        </div>
        <div aria-hidden className={cx('mt-2 flex', kind === 'week' ? 'gap-2.5 px-1' : 'gap-[3px]')}>
          {series.map((d, i) => (
            <span
              key={d.date}
              className={cx(
                'tnum flex-1 text-center text-[12px] leading-none',
                d.date === today ? 'font-semibold text-white' : 'text-white/55',
                kind === 'month' && 'overflow-visible whitespace-nowrap',
              )}
            >
              {labelFor(d, i)}
            </span>
          ))}
        </div>
      </div>
      <table className="sr-only">
        <caption>Spending per day</caption>
        <tbody>
          {series
            .filter((d) => kind === 'week' || d.amount > 0)
            .map((d) => (
              <tr key={d.date}>
                <th scope="row">{formatDayHeading(d.date, today)}</th>
                <td>{format(d.amount)}</td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  );
}
