// The display locale, in one place. Every `Intl` formatter and `toLocale*` call reads it here.
//
// It was spelled out sixteen times before 16/09; a copied locale gets fixed fifteen times on the
// day it changes, and the sixteenth puts a date in a different order than its neighbour.
//
// `en-GB`, not `en-US`, because of the clock rather than the date. Date order matters at exactly
// one place (`infra/LogsPage.tsx`, the only numeric date); every other date uses `month: "short"`.
// The 24-hour clock is what twelve screens display and document ("19:00", "Wed 23:13"); `en-US`
// would have switched them to AM/PM, a design change smuggled in with a translation, paid for in
// width by trace and log rows.
//
// Locale of the text, not the time zone: formatters resolve the zone from the browser, where the
// operator is, never where the server runs.
export const LOCALE = "en-GB";
