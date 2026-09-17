// The words of the push card. The rest of the card carries its text in the clear: this file
// only keeps what must read as one block, because that cost time once.
export const PUSH_TEXT = {
  /** THE GLOBAL SWITCH ALSO CUTS PUSH. A subscribed device, a question waiting, and nothing
   *  arriving: the cause was the crossed-out bell in the bar, one screen away. The banner says
   *  the cause AND where the gesture is — an alert that does not say what to do is an alert
   *  people learn to ignore. */
  muted: {
    title: "Notifications are off",
    body: "The global switch in the bar stops them all — push, webhooks, channels. This device stays subscribed, it just receives nothing while the bell is crossed out.",
  },
  card: {
    title: "Push notifications",
    subscribed: "this device is subscribed",
    notSubscribed: "this device is not subscribed",
    desc: "What is waiting for a decision reaches the lock screen, even with the app closed. Nothing leaves the instance: the message goes out encrypted to the manufacturer's push service, which relays it without being able to read it.",
  },
  needsHomeScreen:
    'iOS only pushes notifications to an installed app. Share, then "Add to Home Screen", and reopen Legion from that icon.',
  denied:
    "This browser refused notifications for this site. That reopens in its settings, not from this page.",
  noSubscriptions: "No device subscribed — nothing reaches a phone.",
  devicesLabel: "Subscribed devices",
  allEvents: "all events",
  forget: "Remove this device",
  deviceFallback: "Device",
  disable: "Stop receiving on this device",
  enable: "Enable notifications",
  deniedError:
    "Notifications refused for this site. That reopens in the browser's settings, not here.",
  permissionNotGranted: "Permission not granted.",
  incompleteSubscription: "The browser returned an incomplete subscription.",
} as const;
