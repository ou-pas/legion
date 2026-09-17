// Files go up as base64 INSIDE JSON, not multipart. One transport: skill and rule uploads
// (`POST /api/skills`) and the artifact binary channel (`contentBase64`) already do it, and brief
// attachments follow rather than opening a second path with its own limits and failure modes.

/** btoa(String.fromCharCode(...arr)) blows the stack beyond ~100 KB, hence the chunked conversion. */
export function toB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Original size of base64 content, to display it and to refuse before sending. */
export function bytesOf(b64: string): number {
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.max(0, (b64.length * 3) / 4 - padding);
}

/** BASE64URL → bytes (`-` and `_` replace `+` and `/`, `=` padding omitted). A VAPID key travels
 *  in that form, and `PushManager.subscribe` wants bytes, not a string: without this conversion the
 *  browser refuses the subscription with an error that does not say why. */
export function fromB64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const bin = atob(padded);
  // The buffer is built explicitly: `new Uint8Array(size)` types as `ArrayBufferLike`, which
  // includes `SharedArrayBuffer`, and `PushManager.subscribe` only accepts an `ArrayBuffer`.
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
