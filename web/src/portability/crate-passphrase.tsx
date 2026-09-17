// The crate passphrase, typed twice.
//
// Checked here, not only on the server: the server refuses a too-short passphrase, but it cannot
// refuse the same typo made twice. A passphrase mistyped identically yields a perfectly valid crate
// nobody can open. The second entry is the only possible guard.
import { Field } from "../ui/form.js";
import { Input } from "../ui/input.js";
import { Stack } from "../ui/flex.js";
import { CRATE_TEXT } from "./text.js";

export const PASSPHRASE_MIN = 12;

/** True when both entries match and meet the minimum length. */
export function passphraseReady(pass: string, repeat: string): boolean {
  return pass.length >= PASSPHRASE_MIN && repeat === pass;
}

export function CratePassphrase({
  pass,
  repeat,
  onPass,
  onRepeat,
}: {
  pass: string;
  repeat: string;
  onPass: (v: string) => void;
  onRepeat: (v: string) => void;
}) {
  const t = CRATE_TEXT.export;
  const short = pass.length > 0 && pass.length < PASSPHRASE_MIN;
  const mismatch = repeat.length > 0 && repeat !== pass;
  return (
    <Stack gap={12}>
      <Field
        label={t.passphrase}
        hint={short ? t.tooShort(pass.length, PASSPHRASE_MIN) : t.passphraseHint}
      >
        <Input
          type="password"
          autoComplete="new-password"
          value={pass}
          invalid={short}
          onChange={(e) => onPass(e.target.value)}
        />
      </Field>
      <Field label={t.repeat} error={mismatch ? t.mismatch : undefined}>
        <Input
          type="password"
          autoComplete="new-password"
          value={repeat}
          onChange={(e) => onRepeat(e.target.value)}
        />
      </Field>
    </Stack>
  );
}
