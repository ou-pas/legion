// THE PLURAL RULE, in one place. Every phrase of the interface that agrees a word with a count
// reads it from here.
//
// It was recopied ninety-six times before (16/09), fifty-five of them as the very same
// `${n} task${n > 1 ? "s" : ""}`. A rule recopied is a rule each catalogue can get wrong on its
// own, and two already had: the goals list printed "1 iterations", and a run's trace announced
// its live noun as "events" whatever the count. Two different lots reported them, neither knowing
// about the other.
//
// `n > 1` was the recopied test, and it is wrong at ZERO: "0 task" where English says "0 tasks".
// English keeps the singular for exactly one and pluralises everything else, zero included — so
// the test is `count === 1`, and converting a call site fixes its zero along the way.
//
// This is NOT an internationalisation engine. `Intl.PluralRules` and its six categories answer a
// question Legion does not have: there is one output language.
//
// It returns the WORD, not the count, so that the count keeps whatever shape its screen gives it
// — a `<Num>` chip in the goals list, a plain interpolation everywhere else. That is also why the
// same call handles agreement beyond the final "s": `one` and `many` are simply the form for
// exactly one and the form for any other count, whether that form is a noun ("session"), a verb
// after a singular subject ("references"), or a whole phrase ("it was" / "they were").
export function plural(count: number, one: string, many = `${one}s`): string {
  return count === 1 ? one : many;
}
