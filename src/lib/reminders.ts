import type { ReminderPrefs, Settings } from './types';

/**
 * Weekly reminders run only while SpendNote is open, or the next time it is opened.
 * There is no push server, so nothing here can wake a closed app.
 */

/** The most recent scheduled reminder time at or before `now`. */
export function lastOccurrence(r: ReminderPrefs, now: Date): Date {
  const [h, m] = r.time.split(':').map(Number);
  const mondayFirst = (now.getDay() + 6) % 7;
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - mondayFirst + r.weekday, h, m, 0, 0);
  if (d.getTime() > now.getTime()) d.setDate(d.getDate() - 7);
  return d;
}

export function nextOccurrence(r: ReminderPrefs, now: Date): Date {
  const last = lastOccurrence(r, now);
  const next = new Date(last);
  next.setDate(next.getDate() + 7);
  return next;
}

/** True when a reminder time has passed since the user last enabled, opened or dismissed the reminder. */
export function isReminderDue(s: Settings, now: Date): boolean {
  if (!s.reminder.enabled) return false;
  const last = lastOccurrence(s.reminder, now);
  const ack = s.reminderAckAt ? new Date(s.reminderAckAt).getTime() : 0;
  return last.getTime() > ack;
}

export type NotificationState = 'unsupported' | 'default' | 'granted' | 'denied';

export function notificationState(): NotificationState {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission as NotificationState;
}

export async function showReminderNotification(body: string): Promise<boolean> {
  if (notificationState() !== 'granted') return false;
  const options: NotificationOptions = {
    body,
    icon: '/pwa-192.png',
    badge: '/pwa-192.png',
    tag: 'spendnote-weekly-review',
    data: { url: '/#/review' },
  };
  try {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    if (reg) {
      await reg.showNotification('Weekly review', options);
      return true;
    }
    new Notification('Weekly review', options);
    return true;
  } catch {
    return false;
  }
}
