// The subscription gesture, browser side. Rules are in `push-support.ts`; here are the effects, in
// an order imposed by the platform, and each step can refuse:
//  1. register the service worker (`/sw.js`, at the root so it covers the whole screen);
//  2. request permission, inside the user gesture: Safari refuses
//     `Notification.requestPermission()` from an effect or a timer, with no signal but a promise
//     resolving "denied". Hence a button, not an automatic subscription on load;
//  3. subscribe through `PushManager` with the server's public key, base64url turned into bytes;
//  4. send it to the server, the only one able to use it.
//
// `userVisibleOnly: true` is mandatory in Chrome: a push showing nothing would be a silent channel
// to a page, and no browser grants that.
import { useCallback, useEffect, useState } from "react";
import { pushApi } from "../api/notifications.js";
import { fromB64Url } from "../api/base64.js";
import {
  pushAvailability,
  readPushEnvironment,
  suggestDeviceLabel,
  type PushAvailability,
} from "./push-support.js";
import { PUSH_TEXT } from "./text-push.js";

export type PushState = {
  availability: PushAvailability;
  /** What the browser already granted or denied: `default` = never asked. */
  permission: NotificationPermission;
  /** This browser has a live subscription. */
  subscribed: boolean;
  busy: boolean;
  error: string | null;
};

/** The browser keeps its subscription, the server keeps its own, and they can diverge (restored
 *  database, row deleted by hand). The button follows the browser: it is the one that receives. */
async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export function usePush(): PushState & {
  enable: () => Promise<void>;
  disable: () => Promise<void>;
} {
  // Read at initialisation, not in an effect. Browser capabilities and granted permission are
  // synchronous facts, stable for a mount: setting them in an effect would render a lying first
  // frame ("unsupported") then a correcting one, which `react(set-state-in-effect)` refuses.
  const [availability] = useState<PushAvailability>(() => pushAvailability(readPushEnvironment()));
  const [permission, setPermission] = useState<NotificationPermission>(() =>
    "Notification" in window ? Notification.permission : "default",
  );
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The existing subscription can only be read asynchronously: the one fact of this hook needing
  // an effect, and it writes only once the promise resolves.
  useEffect(() => {
    if (availability.state !== "ready") return;
    let alive = true;
    void currentSubscription().then((s) => {
      if (alive) setSubscribed(s !== null);
    });
    return () => {
      alive = false;
    };
  }, [availability.state]);

  const enable = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      // Explicit `scope: "/"`: a root-served service worker gets it anyway, but saying so avoids
      // depending on a default if the file ever moves.
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      const granted = await Notification.requestPermission();
      setPermission(granted);
      if (granted !== "granted") {
        // A denial is not asked again. The browser never reopens the dialog once "Block" is chosen;
        // only a system setting does, and saying so is the only useful thing to do here.
        setError(granted === "denied" ? PUSH_TEXT.deniedError : PUSH_TEXT.permissionNotGranted);
        return;
      }
      const { publicKey } = await pushApi.key();
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: fromB64Url(publicKey),
      });
      // `toJSON()` gives exactly the shape the route expects (endpoint and both keys). Relayed as
      // is: reformatting would be a chance to get wrong values we cannot reread.
      const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth)
        throw new Error(PUSH_TEXT.incompleteSubscription);
      await pushApi.subscribe({
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        label: suggestDeviceLabel(navigator.userAgent),
      });
      setSubscribed(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  const disable = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const sub = await currentSubscription();
      // Browser first, server second, and that is the right order: a row left in the database only
      // costs a refused send, cleaned up by the server on the first 410. A subscription left alive
      // in the browser after its row is gone shows nowhere, and can no longer be cut.
      await sub?.unsubscribe();
      const { subscriptions } = await pushApi.subscriptions();
      const tail = sub?.endpoint.slice(-12);
      const mine = subscriptions.find((s) => s.endpointTail === tail);
      if (mine) await pushApi.unsubscribe(mine.id);
      setSubscribed(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  return { availability, permission, subscribed, busy, error, enable, disable };
}
