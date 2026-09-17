// That each `kind` of ArtifactPreview renders the RIGHT element, measured in the DOM rather than
// assumed from reading: text keeps the sandboxed iframe, image a plain `<img>`, binary a download
// link with no preview attempt.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ArtifactChip, ArtifactPreview } from "./artifact-chip.js";

afterEach(cleanup);

describe("ArtifactPreview: rendering follows `kind`, never guessed", () => {
  it("text: sandboxed iframe, established behaviour unchanged", () => {
    render(
      <ArtifactPreview
        name="pr.md"
        src="/api/tasks/t1/artifacts/pr.md"
        kind="text"
        onClose={() => {}}
      />,
    );
    const frame = screen.getByTitle("pr.md") as HTMLIFrameElement;
    expect(frame.tagName).toBe("IFRAME");
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.src).toContain("/api/tasks/t1/artifacts/pr.md");
    expect(document.querySelector("img")).toBeNull();
  });

  it("image: plain <img>, never inside the iframe", () => {
    render(
      <ArtifactPreview
        name="capture.png"
        src="/api/tasks/t1/artifacts/capture.png"
        kind="image"
        onClose={() => {}}
      />,
    );
    const img = screen.getByAltText("capture.png") as HTMLImageElement;
    expect(img.tagName).toBe("IMG");
    expect(img.src).toContain("/api/tasks/t1/artifacts/capture.png");
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("non-image binary: no preview attempted, a download link instead", () => {
    render(
      <ArtifactPreview
        name="export.zip"
        src="/api/tasks/t1/artifacts/export.zip"
        kind="binary"
        onClose={() => {}}
      />,
    );
    expect(document.querySelector("iframe")).toBeNull();
    expect(document.querySelector("img")).toBeNull();
    const link = screen.getByRole("link", { name: /Download export\.zip/ }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/api/tasks/t1/artifacts/export.zip");
    expect(link.getAttribute("download")).toBe("export.zip");
  });
});

// The scenario defended here: an agent drops `report.html` containing
// `<script>fetch('/api/secrets')</script>`. The server serves it as `text/html` (so it RENDERS, that
// is the point), and nothing on screen may give it the app's origin.
// This test measures the only lock the front owns: the sandbox tokens. `allow-same-origin` would let
// the document read the API with the operator's credentials, and a test checking only
// `sandbox="allow-scripts"` would let an `allow-scripts allow-same-origin` added "to make it work"
// through.
// The second lock cannot be measured in jsdom: the `Content-Security-Policy: sandbox allow-scripts`
// the server sets on every artifact, covering opening in a TAB where the frame attribute no longer
// plays. Measured in Chrome on 04/09 on both paths, against a SAME-ORIGIN endpoint with a session
// cookie, in the frame and in the tab: `window.origin` is "null", `document.cookie` and the host DOM
// throw SecurityError, and `fetch('/api/secrets')` fails (TypeError). The request leaves with
// `Origin: null` and NO cookie, and the response stays unreadable. Details in the report of the
// "lire des artifacts html" task.
describe("ArtifactPreview: an HTML report renders without ever touching the app", () => {
  const html = { name: "report.html", src: "/api/tasks/t1/artifacts/report.html" };

  it("html: rendered in the iframe, and the content does not enter the app DOM", () => {
    const { container } = render(<ArtifactPreview {...html} kind="text" onClose={() => {}} />);
    const frame = screen.getByTitle("report.html") as HTMLIFrameElement;
    expect(frame.tagName).toBe("IFRAME");
    expect(frame.src).toContain(html.src);
    // The agent document's only node is the frame itself: no srcdoc, no injection.
    expect(frame.getAttribute("srcdoc")).toBeNull();
    expect(container.querySelectorAll("script").length).toBe(0);
  });

  it("the sandbox NEVER grants allow-same-origin", () => {
    render(<ArtifactPreview {...html} kind="text" onClose={() => {}} />);
    const tokens = (screen.getByTitle("report.html").getAttribute("sandbox") ?? "").split(/\s+/);
    expect(tokens).toContain("allow-scripts");
    expect(tokens).not.toContain("allow-same-origin");
    expect(tokens).not.toContain("allow-top-navigation");
  });

  it('"open in a tab" targets the artifact, in a detached context', () => {
    render(<ArtifactPreview {...html} kind="text" onClose={() => {}} />);
    const link = screen.getByRole("link", {
      name: "Open report.html in a tab",
    }) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(html.src);
    expect(link.getAttribute("target")).toBe("_blank");
    // `noreferrer` implies `noopener`: the opened tab has no `window.opener` to drive.
    expect(link.getAttribute("rel")).toContain("noreferrer");
  });

  it("a binary offers no tab: it only has a download", () => {
    render(
      <ArtifactPreview
        name="export.zip"
        src="/api/tasks/t1/artifacts/export.zip"
        kind="binary"
        onClose={() => {}}
      />,
    );
    expect(screen.queryByRole("link", { name: /in a tab/ })).toBeNull();
  });
});

describe("ArtifactChip: the icon follows `kind`", () => {
  it('a missing expected artifact keeps its "dotted" icon, whatever `kind`', () => {
    render(<ArtifactChip name="review.md" present={false} />);
    expect(screen.getByText("review.md")).toBeTruthy();
  });

  it("present: the chip shows size and name whatever the type", () => {
    render(<ArtifactChip name="capture.png" sizeBytes={812_000} kind="image" />);
    expect(screen.getByText("capture.png")).toBeTruthy();
  });
});
