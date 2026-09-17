// Minimal `**bold**` rendering for text produced by agents / the Discord bot. Deliberately not a
// Markdown parser: no injected HTML, just text and <b>.
export function Markish({ text }: { text: string }) {
  return (
    <>
      {text
        .split(/(\*\*[^*]+\*\*)/g)
        .map((part, i) =>
          part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
            <b key={i}>{part.slice(2, -2)}</b>
          ) : (
            part
          ),
        )}
    </>
  );
}
