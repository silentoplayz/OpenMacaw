/**
 * notifications.ts
 *
 * Thin wrapper around the browser Notifications API.
 * Works in three contexts:
 *   1. Page is visible           → no notification (user can see the result)
 *   2. Page is hidden/background → fires a native notification via the
 *                                   service worker (if registered) so it
 *                                   appears in the Android notification shade
 *   3. PWA not installed yet     → still works as long as the tab exists
 *
 * Usage:
 *   import { notify, requestNotificationPermission } from '@/lib/notifications';
 *   notify({ title: 'Agent done', body: 'Your task has been completed.' });
 */

export type NotifyOptions = {
  title: string;
  body?: string;
  /** Relative URL to open when the notification is clicked. Defaults to '/chat'. */
  url?: string;
  /** Icon shown in the notification (uses app icon by default). */
  icon?: string;
  /** Vibration pattern in ms [vibrate, pause, vibrate, …] */
  vibrate?: number[];
  /** One of 'default' | 'silent' | 'granted' — forwarded as Notification.silent */
  silent?: boolean;
  /** Notification tag — replaces an existing notification with the same tag. */
  tag?: string;
};

/** Returns the current notification permission state. */
export function notificationPermission(): NotificationPermission {
  if (!('Notification' in window)) return 'denied';
  return Notification.permission;
}

/** Returns true if the browser supports the Notifications API. */
export function notificationsSupported(): boolean {
  return 'Notification' in window;
}

/**
 * Request notification permission from the user.
 * Returns the final permission state after the prompt.
 * Safe to call multiple times — the browser de-dupes the prompt.
 */
export async function requestNotificationPermissionAsync(): Promise<NotificationPermission> {
  if (!notificationsSupported()) return 'denied';
  if (Notification.permission === 'granted') return 'granted';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/**
 * Fire a notification — but only when the page is not currently visible.
 * Prefers the service worker's showNotification() so the notification is
 * persistent on Android; falls back to a plain Notification object.
 */
export async function notifyAsync(opts: NotifyOptions): Promise<void> {
  // Never interrupt the user while they are looking at the app.
  if (document.visibilityState === 'visible') return;
  if (!notificationsSupported()) return;
  if (Notification.permission !== 'granted') return;

  const icon = opts.icon ?? '/icons/icon-192.svg';
  const badge = '/icons/icon-192.svg';
  const vibrate = opts.vibrate ?? [200, 100, 200];
  const tag = opts.tag ?? 'openmacaw-default';
  const url = opts.url ?? '/chat';

  // Prefer service-worker backed notification (persistent, shown in notification shade)
  if ('serviceWorker' in navigator) {
    const reg = await navigator.serviceWorker.getRegistration('/');
    if (reg) {
      // ServiceWorkerRegistration.showNotification supports vibrate/badge
      // which are not in the base NotificationOptions TS type.
      await reg.showNotification(opts.title, {
        body: opts.body,
        icon,
        tag,
        silent: opts.silent ?? false,
        data: { url },
        // Extra fields — cast to avoid strict TS complaints
        ...({ badge, vibrate } as object),
      } as NotificationOptions);
      return;
    }
  }

  // Fallback: plain Notification (no persistent badge on Android but still works)
  const n = new Notification(opts.title, {
    body: opts.body,
    icon,
    tag,
    silent: opts.silent ?? false,
  });
  n.onclick = () => {
    window.focus();
    n.close();
  };
}

// ── Convenience helpers ──────────────────────────────────────────────────────

/** Fire a notification when an agent turn finishes with a response. */
export function notifyAgentDoneAsync(agentName = 'OpenMacaw'): Promise<void> {
  return notifyAsync({
    title: `${agentName} finished`,
    body: 'The agent has completed its response.',
    tag: 'openmacaw-agent-done',
    url: '/chat',
  });
}

/** Fire a notification when a tool call is denied by the permission guard. */
export function notifyToolDeniedAsync(toolName: string, reason?: string): Promise<void> {
  return notifyAsync({
    title: 'Tool call blocked',
    body: reason
      ? `${toolName}: ${reason}`
      : `${toolName} was blocked by the permission guard.`,
    tag: 'openmacaw-tool-denied',
    url: '/activity',
    vibrate: [300, 100, 300, 100, 300],
  });
}
