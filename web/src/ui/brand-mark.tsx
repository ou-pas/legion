// The product mark, the same drawing as the app icon.
//
// Tokens, not fixed colors: `public/icon.svg` follows the device theme, while this one follows
// the theme chosen in the app. No background square either: the mark already sits on a product
// surface, so the viewBox is tight on the glyph.
//
// Not an icon in the contract's sense ("lucide-react only"): it is the brand mark, which no
// library has.
export function BrandMark() {
  return (
    <svg viewBox="136 118 240 264" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="136" y="130" width="104" height="252" rx="20" fill="var(--ink)" />
      <rect x="256" y="278" width="104" height="104" rx="20" fill="var(--ink)" />
      <rect x="272" y="118" width="104" height="104" rx="20" fill="var(--accent)" />
    </svg>
  );
}
