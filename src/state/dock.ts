import { useSyncExternalStore } from 'react';

/**
 * On the Overview, the wide orange "Add expense" slab under the summary card is the
 * main action. While it's on screen the docked mobile button hides, so there's only
 * ever one prominent Add button visible at a time.
 */
let slabVisible = false;
const listeners = new Set<() => void>();

export function setSlabVisible(v: boolean) {
  if (v === slabVisible) return;
  slabVisible = v;
  listeners.forEach((l) => l());
}

export function useSlabVisible() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => slabVisible,
  );
}
