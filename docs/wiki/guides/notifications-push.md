# Getting notifications on your phone

Legion can push to the lock screen what is waiting for a decision: an approval, an agent's question, a
failed task. The app does not need to be open, nor the browser running.

This guide describes what it takes, in the order it happens, and what breaks silently if a step is
missing.

## What you need first

An HTTPS origin. A browser refuses to register a service worker on an insecure origin, and without a
service worker there is nobody to display a notification once the tab is closed. See [[guides/tls]].

On iPhone or iPad, two more conditions, and they cannot be worked around: iOS 16.4 or newer, and the
app added to the home screen. In a Safari tab, Web Push does not exist. The screen says so rather than
greying out a button with no explanation.

## Installing the app

Open the instance's address in Safari, Share button, Add to Home Screen. Reopen Legion from the icon
this creates: that window is the one allowed to subscribe, not the original tab.

On Android and on a desktop, the browser offers installation but it is not required.

## Subscribing

System, General section, the phone notifications card, then its enable button. The browser asks for
permission; once granted, the device appears in the card's list.

Permission is requested from a CLICK, never on load: Safari refuses a request that is not inside a
user gesture, and returns "denied" with no further explanation.

A refusal is not asked again. The browser does not reopen its dialog once "Don't Allow" was chosen;
you have to go through its own settings.

## What goes out, and what stays

What is pushed is the one-line sentence Legion already writes for its other channels: what is
happening, then on what. It contains no diff and no task content.

The message leaves ENCRYPTED for the vendor's push service (Apple, Google, Mozilla), which relays it
without being able to read it: the encryption keys are made by the browser and never leave the
instance. So the server needs outbound access, nothing inbound.

An undelivered message is kept four hours then dropped. Without that ceiling, a phone switched back on
the next day would pour out the whole night at once.

## Choosing what gets pushed

By default, everything notifiable. Each subscription carries its list of events, with the same
convention as outgoing webhooks: an empty list means all.

A phone that buzzes for an opened PR becomes a phone put on silent, and then the gate that really is
waiting wakes nobody either. If that happens, the list is there for it.

## When nothing arrives

The global notifications switch cuts everything, push included: it is the bell in the top bar, and the
card shows a banner while it is off.

A subscription dies without warning when the app is uninstalled or the permission withdrawn. The push
service then answers 404 or 410, and Legion removes the row at that moment; it is the only signal it
will get. Subscribing again is enough.

The server's identity keys (VAPID) are made once and kept. Regenerating them would silently invalidate
every existing subscription: sends would go out, the push service would refuse them, and nobody would
be told.

## See also

- [[guides/tls]] for the secure origin, without which none of this exists
- [[guides/harnais]] for the repository's gates
