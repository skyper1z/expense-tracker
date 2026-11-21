import { useSyncExternalStore } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type Platform = 'ios' | 'android' | 'desktop';
export type BrowserKind = 'chromium' | 'safari' | 'firefox' | 'samsung' | 'in-app' | 'other';
export type Device = 'iphone' | 'ipad' | 'android' | 'desktop';

interface InstallState {
  /** The browser has offered to install, so our button can open its install prompt. */
  canPrompt: boolean;
  /** Installed on this device: we're running as the app, or it was installed during this visit. */
  installed: boolean;
  /** This window is the installed app (not a normal browser tab). */
  runningAsApp: boolean;
  /** Installed during this visit; the person should now open it from their home screen or apps. */
  justInstalled: boolean;
  isIOS: boolean;
  platform: Platform;
  browser: BrowserKind;
  device: Device;
  /** Safari's own version (e.g. 26 on iOS 26, where Share moved behind the ⋯ button). */
  safariMajor: number | null;
}

let deferred: BeforeInstallPromptEvent | null = null;
let state: InstallState = {
  canPrompt: false, installed: false, runningAsApp: false, justInstalled: false, isIOS: false, platform: 'desktop', browser: 'other',
  device: 'desktop', safariMajor: null,
};
const listeners = new Set<() => void>();

function set(patch: Partial<InstallState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

/** Display modes an installed SpendNote window can be in. (Not "fullscreen": F11 in a normal tab matches that.) */
const APP_MODES = ['(display-mode: standalone)', '(display-mode: window-controls-overlay)'];

function detectRunningAsApp(): boolean {
  return (
    APP_MODES.some((q) => window.matchMedia(q).matches) ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function detectBrowser(
  ua: string,
  maxTouchPoints = 0,
): { platform: Platform; browser: BrowserKind; isIOS: boolean; device: Device; safariMajor: number | null } {
  const isIPad = /iPad/.test(ua) || (ua.includes('Macintosh') && maxTouchPoints > 1);
  const isIOS = isIPad || /iPhone|iPod/.test(ua);
  const platform: Platform = isIOS ? 'ios' : /Android/i.test(ua) ? 'android' : 'desktop';
  const device: Device = isIPad ? 'ipad' : isIOS ? 'iphone' : platform === 'android' ? 'android' : 'desktop';
  // Browsers built into other apps (WhatsApp, Instagram, Facebook, TikTok…) can't install web apps.
  const inApp = /FBAN|FBAV|FB_IAB|Instagram|Line\/|WhatsApp|Snapchat|TikTok|musical_ly|Twitter|LinkedInApp|GSA\/|; wv\)/i.test(ua);
  const browser: BrowserKind = inApp
    ? 'in-app'
    : /Firefox\/|FxiOS/.test(ua)
      ? 'firefox'
      : /SamsungBrowser/.test(ua)
        ? 'samsung'
        : /Chrome\/|CriOS|Edg\/|EdgiOS/.test(ua)
          ? 'chromium'
          : /Safari\//.test(ua)
            ? 'safari'
            : 'other';
  const v = browser === 'safari' ? /Version\/(\d+)/.exec(ua) : null;
  return { platform, browser, isIOS, device, safariMajor: v ? Number(v[1]) : null };
}

/** Must run before React mounts: the browser may fire beforeinstallprompt very early. */
export function initInstallCapture() {
  const running = detectRunningAsApp();
  state = { ...state, ...detectBrowser(navigator.userAgent, navigator.maxTouchPoints), runningAsApp: running, installed: running };
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    set({ canPrompt: true });
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    set({ canPrompt: false, installed: true, justInstalled: !detectRunningAsApp() });
  });
  // Chrome can move this very page into the new app window after installing.
  for (const q of APP_MODES) {
    window.matchMedia(q).addEventListener('change', () => {
      const now = detectRunningAsApp();
      set({ runningAsApp: now, installed: state.installed || now, justInstalled: now ? false : state.justInstalled });
    });
  }
}

export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  if (!deferred) return 'unavailable';
  const e = deferred;
  deferred = null;
  set({ canPrompt: false });
  await e.prompt();
  const choice = await e.userChoice;
  return choice.outcome;
}

export function useInstall(): InstallState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}
