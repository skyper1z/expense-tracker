import { AlertTriangle, CheckCircle2, ChevronDown, Info, XCircle, type LucideIcon } from 'lucide-react';
import {
  forwardRef, useId, useLayoutEffect, useRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode,
  type SelectHTMLAttributes, type TextareaHTMLAttributes,
} from 'react';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

/* ------------------------------------------------------------------ */
/* Buttons                                                             */
/* ------------------------------------------------------------------ */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'white';
type ButtonSize = 'sm' | 'md' | 'lg';

const BTN_VARIANT: Record<ButtonVariant, string> = {
  primary: 'btn-flame font-semibold',
  secondary: 'bg-white/[0.07] hover:bg-white/[0.11] text-white border border-white/[0.08] font-medium',
  ghost: 'text-white/80 hover:text-white hover:bg-white/[0.06] font-medium',
  danger: 'bg-danger-400/10 hover:bg-danger-400/[0.16] text-danger-300 border border-danger-400/25 font-medium',
  white: 'bg-white text-black hover:bg-white/90 font-semibold',
};
const BTN_SIZE: Record<ButtonSize, string> = {
  sm: 'h-10 px-4 text-[14px] gap-1.5',
  md: 'h-12 px-5 text-[15px] gap-2',
  lg: 'h-14 px-6 text-[16px] gap-2',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon: Icon, block, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx(
        'inline-flex select-none items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-45',
        BTN_VARIANT[variant],
        BTN_SIZE[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {Icon && <Icon size={size === 'sm' ? 17 : 19} strokeWidth={1.7} aria-hidden className="shrink-0" />}
      {children}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  label: string;
  tone?: 'dark' | 'white' | 'ghost' | 'black';
  size?: number;
  iconSize?: number;
}

/** Circular icon button. Always has an accessible label. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon: Icon, label, tone = 'dark', size = 44, iconSize, className, type = 'button', ...rest },
  ref,
) {
  const tones = {
    dark: 'bg-ink-700/90 hover:bg-ink-600 text-white border border-white/[0.07]',
    black: 'bg-ink-950 hover:bg-black text-white border border-white/[0.09]',
    white: 'bg-white hover:bg-white/90 text-black',
    ghost: 'text-white/75 hover:text-white hover:bg-white/[0.07]',
  };
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-35',
        tones[tone],
        className,
      )}
      style={{ width: size, height: size }}
      {...rest}
    >
      <Icon size={iconSize ?? Math.round(size * 0.44)} strokeWidth={1.6} aria-hidden />
    </button>
  );
});

/* ------------------------------------------------------------------ */
/* Segmented control                                                   */
/* ------------------------------------------------------------------ */

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  size = 'md',
  className,
}: {
  options: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cx('inline-flex rounded-[24px] border border-white/[0.08] bg-white/[0.06] p-1', className)}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={cx(
              // Labels stay on one line normally, but may wrap on very narrow phones instead of overflowing.
              'inline-flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-[20px] text-center font-medium leading-tight transition-colors',
              size === 'sm' ? 'min-h-8 px-3.5 py-1 text-[13px]' : 'min-h-10 px-4 py-1.5 text-[15px] sm:px-5',
              active ? 'bg-white text-black shadow-sm' : 'text-white/70 hover:text-white',
            )}
          >
            <span className="min-w-0 text-balance">{o.label}</span>
            {o.count !== undefined && (
              <span className={cx('tnum shrink-0 rounded-full px-1.5 text-[12px]', active ? 'bg-black/10' : 'bg-white/10')}>
                {o.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Form fields                                                         */
/* ------------------------------------------------------------------ */

export const inputBase =
  'w-full rounded-2xl border bg-ink-800 px-4 text-[16px] text-white placeholder:text-white/45 outline-none transition-colors focus:border-flame-400/70 focus:ring-2 focus:ring-flame-500/20';

export function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
  labelExtra,
  className,
  hideLabel,
}: {
  label: ReactNode;
  htmlFor: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  labelExtra?: ReactNode;
  className?: string;
  hideLabel?: boolean;
}) {
  return (
    <div className={className}>
      <div className={cx('mb-2 flex items-center justify-between gap-3', hideLabel && 'sr-only')}>
        <label htmlFor={htmlFor} className="text-[15px] font-medium text-white">
          {label}
        </label>
        {labelExtra}
      </div>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="mt-2 flex items-start gap-1.5 text-[14px] text-danger-300">
          <XCircle size={16} strokeWidth={1.8} className="mt-[2px] shrink-0" aria-hidden />
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="mt-2 text-[13px] leading-snug text-white/60">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function describedBy(id: string, error?: string, hint?: ReactNode) {
  return error ? `${id}-error` : hint ? `${id}-hint` : undefined;
}

export const TextInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function TextInput({ className, invalid, ...rest }, ref) {
    return (
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cx(inputBase, 'h-12', invalid ? 'border-danger-400/70' : 'border-white/[0.08]', className)}
        {...rest}
      />
    );
  },
);

/** Grows with its content so long notes stay readable. */
export const TextArea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean; minRows?: number; maxRows?: number }
>(function TextArea({ className, invalid, minRows = 3, maxRows = 10, value, ...rest }, ref) {
  const inner = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    el.style.height = 'auto';
    const line = 24;
    const min = minRows * line + 24;
    const max = maxRows * line + 24;
    el.style.height = `${Math.min(max, Math.max(min, el.scrollHeight + 2))}px`;
  }, [value, minRows, maxRows]);
  return (
    <textarea
      ref={(el) => {
        inner.current = el;
        if (typeof ref === 'function') ref(el);
        else if (ref) ref.current = el;
      }}
      value={value}
      aria-invalid={invalid || undefined}
      className={cx(
        inputBase,
        'resize-none py-3 leading-6',
        invalid ? 'border-danger-400/70' : 'border-white/[0.08]',
        className,
      )}
      {...rest}
    />
  );
});

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean; compact?: boolean }>(
  function Select({ className, invalid, compact, children, ...rest }, ref) {
    return (
      <div className={cx('relative', className)}>
        <select
          ref={ref}
          aria-invalid={invalid || undefined}
          className={cx(
            inputBase,
            'appearance-none pr-11',
            compact ? 'h-11 rounded-full text-[15px]' : 'h-12',
            invalid ? 'border-danger-400/70' : 'border-white/[0.08]',
          )}
          {...rest}
        >
          {children}
        </select>
        <ChevronDown
          size={18}
          strokeWidth={1.7}
          aria-hidden
          className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-white/60"
        />
      </div>
    );
  },
);

export function Chip({
  selected,
  onClick,
  children,
  icon,
  className,
  ...rest
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  icon?: ReactNode;
  className?: string;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'>) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cx(
        'inline-flex h-11 max-w-full items-center gap-2 rounded-full border px-3.5 text-[14px] font-medium transition-colors',
        selected
          ? 'border-white bg-white text-black'
          : 'border-white/[0.09] bg-white/[0.04] text-white/85 hover:bg-white/[0.08] hover:text-white',
        className,
      )}
      {...rest}
    >
      {icon}
      <span className="truncate">{children}</span>
    </button>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <label htmlFor={id} className="text-[15px] font-medium text-white">
          {label}
        </label>
        {description && (
          <p id={`${id}-d`} className="mt-1 text-[13px] leading-snug text-white/60">
            {description}
          </p>
        )}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={description ? `${id}-d` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative mt-0.5 inline-flex h-8 w-[52px] shrink-0 items-center rounded-full border transition-colors disabled:opacity-40',
          checked ? 'border-flame-400 bg-flame-500' : 'border-white/15 bg-white/10',
        )}
      >
        <span
          aria-hidden
          className={cx(
            'inline-block h-6 w-6 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-[23px]' : 'translate-x-[3px]',
          )}
        />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Layout bits                                                         */
/* ------------------------------------------------------------------ */

export function Card({ children, className, as: As = 'section', ...rest }: {
  children: ReactNode;
  className?: string;
  as?: 'section' | 'div' | 'article';
} & React.HTMLAttributes<HTMLElement>) {
  return (
    <As className={cx('surface rounded-[28px] p-5 sm:p-6', className)} {...rest}>
      {children}
    </As>
  );
}

export function SectionHeader({
  title,
  id,
  subtitle,
  action,
  level = 2,
}: {
  title: ReactNode;
  id?: string;
  subtitle?: ReactNode;
  action?: ReactNode;
  level?: 2 | 3;
}) {
  const H = level === 2 ? 'h2' : 'h3';
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <H id={id} className="text-[18px] font-semibold leading-tight tracking-[-0.01em] text-white">
          {title}
        </H>
        {subtitle && <p className="mt-1 text-[14px] text-white/60">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

const CALLOUT: Record<string, { icon: LucideIcon; cls: string }> = {
  info: { icon: Info, cls: 'border-white/[0.08] bg-white/[0.04] text-white/80' },
  warn: { icon: AlertTriangle, cls: 'border-amber-300/25 bg-amber-300/[0.07] text-amber-100' },
  success: { icon: CheckCircle2, cls: 'border-mint-400/25 bg-mint-400/[0.07] text-mint-300' },
  error: { icon: XCircle, cls: 'border-danger-400/30 bg-danger-400/[0.08] text-danger-300' },
};

export function Callout({
  tone = 'info',
  title,
  children,
  className,
  action,
}: {
  tone?: 'info' | 'warn' | 'success' | 'error';
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  const { icon: Icon, cls } = CALLOUT[tone];
  return (
    <div className={cx('flex gap-3 rounded-2xl border p-4 text-[14px] leading-snug', cls, className)}>
      <Icon size={18} strokeWidth={1.8} className="mt-[1px] shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold text-white">{title}</p>}
        {children && <div className={cx(title ? 'mt-1' : null, 'text-white/75')}>{children}</div>}
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-4 py-10 text-center">
      <span className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.05] text-white/80">
        <Icon size={24} strokeWidth={1.5} aria-hidden />
      </span>
      <p className="text-[17px] font-semibold text-white">{title}</p>
      {children && <p className="mt-1.5 max-w-sm text-[14px] leading-relaxed text-white/60">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className="sr-only">{children}</span>;
}
