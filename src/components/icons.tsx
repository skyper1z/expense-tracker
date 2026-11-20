import {
  ArrowLeftRight, Baby, Banknote, BookOpen, Briefcase, Bus, Church, Coffee, Coins, CreditCard, Dumbbell, Fuel, Gift,
  HeartPulse, House, Landmark, PawPrint, Percent, Plane, School, Shapes, Shirt, ShoppingBag, ShoppingBasket, Smartphone,
  Sparkles, Ticket, Users, Wallet, Wrench, Zap, ArrowDownLeft, type LucideIcon, type LucideProps,
} from 'lucide-react';
import type { Category, PaymentMethod, TxType } from '../lib/types';

export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  basket: ShoppingBasket, bus: Bus, zap: Zap, bag: ShoppingBag, ticket: Ticket, heart: HeartPulse,
  shapes: Shapes, percent: Percent, home: House, school: School, gift: Gift, baby: Baby, dumbbell: Dumbbell,
  plane: Plane, coffee: Coffee, phone: Smartphone, wrench: Wrench, paw: PawPrint, church: Church, shirt: Shirt,
  fuel: Fuel, users: Users, book: BookOpen, briefcase: Briefcase, sparkles: Sparkles, coins: Coins,
};

export const METHOD_ICONS: Record<PaymentMethod, LucideIcon> = {
  cash: Banknote,
  momo: Smartphone,
  bank: Landmark,
  card: CreditCard,
  other: Wallet,
};

export function MethodIcon({ method, ...props }: { method: PaymentMethod } & LucideProps) {
  const Icon = METHOD_ICONS[method];
  return <Icon strokeWidth={1.6} aria-hidden {...props} />;
}

/** Solid round badge, like the reference's merchant icons. */
export function CategoryBadge({
  category,
  type = 'expense',
  size = 44,
}: {
  category: Category | undefined;
  type?: TxType;
  size?: number;
}) {
  let Icon: LucideIcon = CATEGORY_ICONS[category?.icon ?? 'shapes'] ?? Shapes;
  let color = category?.color ?? '#A1A1AA';
  if (type === 'income') {
    Icon = ArrowDownLeft;
    color = '#4ADE80';
  } else if (type === 'transfer') {
    Icon = ArrowLeftRight;
    color = '#E5E5E5';
  }
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center rounded-full"
      style={{ width: size, height: size, background: color, color: '#121212' }}
    >
      <Icon size={Math.round(size * 0.46)} strokeWidth={1.8} />
    </span>
  );
}

/** Hex colour → rgba() with alpha, for subtle tints. */
export function tint(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** The SpendNote mark: a dark card resting on an orange slab, echoing the summary card. */
export function LogoMark({ size = 52, className = '' }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 items-center justify-center rounded-full ${className}`}
      style={{
        width: size,
        height: size,
        background: 'radial-gradient(circle at 30% 25%, #ffb27a 0%, #ff6a1a 45%, #b23f0c 100%)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.35)',
      }}
    >
      <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="none">
        <rect x="3.5" y="3" width="17" height="13" rx="4" fill="#121212" />
        <path d="M7.5 8h9M7.5 11.5h5.5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
        <path d="M6 18.5h12" stroke="#121212" strokeWidth="2.4" strokeLinecap="round" opacity="0.55" />
      </svg>
    </span>
  );
}
