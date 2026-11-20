import type { Category } from './types';

export const OTHER_CATEGORY_ID = 'other';
/** Explicit transaction fees are always reported here, separately from the payment itself. */
export const FEES_CATEGORY_ID = 'fees';

export const BUILT_IN_CATEGORIES: Category[] = [
  { id: 'food', name: 'Food & groceries', icon: 'basket', color: '#F5A524', builtIn: true, order: 0 },
  { id: 'transport', name: 'Transport', icon: 'bus', color: '#38BDF8', builtIn: true, order: 1 },
  { id: 'bills', name: 'Bills & utilities', icon: 'zap', color: '#818CF8', builtIn: true, order: 2 },
  { id: 'shopping', name: 'Shopping', icon: 'bag', color: '#F472B6', builtIn: true, order: 3 },
  { id: 'entertainment', name: 'Entertainment', icon: 'ticket', color: '#2DD4BF', builtIn: true, order: 4 },
  { id: 'health', name: 'Health', icon: 'heart', color: '#F87171', builtIn: true, order: 5 },
  { id: 'other', name: 'Other', icon: 'shapes', color: '#A1A1AA', builtIn: true, order: 98 },
  { id: 'fees', name: 'Fees & charges', icon: 'percent', color: '#D6BC9A', builtIn: true, order: 99 },
];

/** Colours offered for custom categories. All have good contrast against dark icons. */
export const CUSTOM_COLORS = ['#FACC15', '#A3E635', '#22D3EE', '#C084FC', '#FB923C', '#E2E8F0', '#FDA4AF', '#5EEAD4'];

export const CUSTOM_ICONS = [
  'home', 'school', 'gift', 'baby', 'dumbbell', 'plane', 'coffee', 'phone',
  'wrench', 'paw', 'church', 'shirt', 'fuel', 'users', 'book', 'briefcase', 'sparkles', 'coins',
];

export function sortCategories(cats: Category[]): Category[] {
  return [...cats].sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}
