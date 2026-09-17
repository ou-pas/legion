// The service worker, and it ONLY does push.
//
// No cache, no request interception, no offline mode, on purpose: a service worker serving cached
// responses is the surest way to freeze a screen on a dead version, and Legion updates by rebuilding.
// It exists because Web Push requires it: a pushed message arrives when the tab is closed, and only
// this file, woken by the browser, can show it.
//
// `skipWaiting` and `clients.claim` because there is nothing to protect: this worker serves no
// request, so no rules change under old tabs, and a notification display fix must apply at once.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  // An unreadable message is still a message. If the body is not the expected JSON (older server, a
  // hand-sent test), a generic notification beats none: the operator must know something happened.
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Legion", body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Legion";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "",
      icon: "/icon-192.png",
      // The badge is the status bar silhouette, not a second icon: Android keeps only its alpha and
      // tints it; the full icon became a blot.
      badge: "/badge.png",
      // The tag replaces instead of stacking: two notifications of the same event on the same source
      // (a gate reminding) must leave ONE line on the lock screen, not a pile.
      tag: data.event || "legion",
      data: { url: data.url || "/" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || "/", self.location.origin).href;
  // Focus the already open tab rather than opening a second: on a phone, two instances of the same app
  // are only escaped by closing everything. A new one opens only if none answers.
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      for (const w of windows)
        if (w.url.startsWith(self.location.origin)) return w.focus().then(() => w.navigate(target));
      return self.clients.openWindow(target);
    }),
  );
});
