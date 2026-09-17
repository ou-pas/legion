// What the browser can do, as pure rules: no call, no effect.
//
// Web Push does not fail the same way everywhere, and the displayed sentence must change, not only
// the button greying out. "Unsupported" on a perfectly capable iPhone, because the screen is open in
// a Safari tab rather than added to the home screen, sends you hunting for a problem that does not
// exist.
//
// Three exclusive cases: the API is missing (old browser, insecure context); it is there but iOS
// only opens it to installed apps; it is there and usable.
//
// An insecure context shows as the API being absent, not through the URL: browsers remove
// `serviceWorker` from `navigator` outside HTTPS (except localhost, deemed safe). Rereading the
// protocol would be wrong, since that exception is what makes local development possible.

export type PushAvailability =
  | { state: "ready" }
  /** iOS 16.4+ in a Safari tab: capable, but only once installed. */
  | { state: "needs-home-screen" }
  | { state: "unsupported"; why: string };

/** What is read from the browser. Passed in rather than read from `window` so the four cases test
 *  without a browser. */
export type PushEnvironment = {
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  /** The screen runs as an installed app (`display-mode: standalone`, or `navigator.standalone`). */
  standalone: boolean;
  /** iPhone or iPad: the only platform refusing push outside an installed app. */
  isApple: boolean;
};

export function pushAvailability(env: PushEnvironment): PushAvailability {
  if (!env.hasServiceWorker || !env.hasPushManager || !env.hasNotification)
    return {
      state: "unsupported",
      why: "This browser cannot receive push notifications, or the origin is not secure.",
    };
  if (env.isApple && !env.standalone) return { state: "needs-home-screen" };
  return { state: "ready" };
}

/** Reads the real environment. The only place in this module touching the browser, and it decides
 *  nothing. */
export function readPushEnvironment(): PushEnvironment {
  const nav = navigator as Navigator & { standalone?: boolean };
  return {
    hasServiceWorker: "serviceWorker" in navigator,
    hasPushManager: "PushManager" in window,
    hasNotification: "Notification" in window,
    standalone: window.matchMedia("(display-mode: standalone)").matches || nav.standalone === true,
    // `maxTouchPoints` identifies a recent iPad, which reports "Macintosh" since iPadOS 13 and that
    // `userAgent` alone no longer reveals.
    isApple:
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1),
  };
}

/** The name this browser carries in the subscribed devices list. Suggested, not imposed: nobody
 *  recognises "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4…" in a list. */
export function suggestDeviceLabel(userAgent: string): string {
  if (/iPhone/.test(userAgent)) return "iPhone";
  if (/iPad/.test(userAgent)) return "iPad";
  if (/Android/.test(userAgent)) return "Android";
  if (/Macintosh/.test(userAgent)) return "Mac";
  if (/Windows/.test(userAgent)) return "PC";
  return "Browser";
}
