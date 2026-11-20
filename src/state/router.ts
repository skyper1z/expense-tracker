import { useSyncExternalStore } from 'react';

export type RouteName = 'overview' | 'expenses' | 'review' | 'settings';
const ROUTES: RouteName[] = ['overview', 'expenses', 'review', 'settings'];

export interface Route {
  name: RouteName;
  params: URLSearchParams;
  raw: string;
}

function parse(hash: string): Route {
  const h = hash.replace(/^#\/?/, '');
  const [path, qs = ''] = h.split('?');
  const name = (ROUTES as string[]).includes(path) ? (path as RouteName) : 'overview';
  return { name, params: new URLSearchParams(qs), raw: hash };
}

let current = parse(typeof location !== 'undefined' ? location.hash : '');
const listeners = new Set<() => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    current = parse(location.hash);
    listeners.forEach((l) => l());
  });
}

export function useRoute(): Route {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

export type Params = Record<string, string | number | boolean | null | undefined>;

export function hrefFor(name: RouteName, params: Params = {}): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === '' || v === false) continue;
    qs.set(k, v === true ? '1' : String(v));
  }
  const s = qs.toString();
  return `#/${name}${s ? `?${s}` : ''}`;
}

export function navigate(name: RouteName, params: Params = {}, opts: { replace?: boolean } = {}) {
  const href = hrefFor(name, params);
  if (href === location.hash) return;
  if (opts.replace) {
    history.replaceState(history.state, '', href);
    current = parse(href);
    listeners.forEach((l) => l());
  } else {
    location.hash = href;
  }
}
