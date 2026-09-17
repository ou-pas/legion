# site

Legion's static site: `index.html`, `site.css`, and copies of the diagrams and screenshots from `docs/`.
Preview it with `npx serve site` or `python3 -m http.server -d site`, from the repository root.
The diagrams and screenshots are copies: run `sh site/sync.sh` after regenerating either, and commit the result.
Fonts (Archivo, JetBrains Mono) and icons were copied once from `web/`; nothing is loaded from `web/` at runtime.
The hero sentence is the README's bold definition, word for word: change both or neither.
