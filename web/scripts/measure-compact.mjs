// Measures the compact breakpoint: what no review proves (13/09).
//
// On 12/09 the navigation work put eleven links in a container the banner rule does not collapse:
// on every route the rail took 683 of an iPhone 13 mini's 812 pixels and content got 129. Lint,
// types, build and the stories gate were green, as they should be: they prove a module compiles and
// a story renders, never that a layout holds. Only a real engine's layout pass says so.
//
// This is not `ds-smoke` coming back (894 stories, six minutes, removed 09/09 partly for CI false
// positives). Here: a few routes, one viewport, assertions that each cost a real defect. A local
// tool, not a `make gates` gate: that decision belongs to the operator.
//
// The rules, and why each exists:
//
//  1. The document does not scroll horizontally.
//  2. No control outside the viewport without a scrolling ancestor. The nuance is the rule: the
//     questionnaire's step strip overflows inside a scroller, which is fine; the launch bar's three
//     buttons overflowed with nothing scrolling, so no task could be launched from a phone.
//  3. Content gets a minimum height. The only rule that would have caught 12/09: nothing
//     overflowed, the screen was just eaten by its own navigation.
//  4. The tools panel, open, keeps its targets at 44px and on screen (14/09, touch audit). Closed it
//     is `display: none` (shell.css), which is why a 29px overflow on its six icons escaped the rules
//     above. The trigger (`.ui-topbar-tools-toggle`) is clicked on each route before measuring.
//  5. No full-width frame inside a full-width frame (14/09, after the inbox defect). DESIGN.md § 4
//     bans nested cards; `frameDepth()` recognises the rendering, not the `.ui-card` class, to also
//     catch a hand-made CSS imitation like `.inbox-qz` was.
//  6. The project mark is the same size in the bar and in the menu it opens (14/09, 28px vs 22px).
//     A closed menu has no box: the trigger (`.ui-topbar-switch`) is clicked on `board` first.
//  7. No thread text painted over the composer at any scroll position (16/09, task "the thread runs
//     over the composer"), plus a geometric check that the composer stays inside `.ch-conv`:
//     `overflow: hidden` can clip it with nothing painted on top. Checked on the demo seed's live
//     channel (`/artifacts/ck80A3w9ET`), running and with a pending question, at 0, 34, 67, 100 %.
//  8. The toast does not sit on the tab bar (16/09). `.ui-toast-region` is always rendered by
//     `ToastProvider`, so its box is measurable without a notification. Before the fix, at 375×780:
//     35px of overlap across the width, and the toast took the tap (`--z-toast` above everything).
//  9. The top bar fits on one row (16/09, task "the top bar no longer wraps"). See `topbarWrapped()`.
//  10-11. Rules A and B (16/09, task "overflows at the compact breakpoint"), for what the rules above
//     missed: the open channel select list (`.ui-select-list`) ran 26px past the right edge (393px in
//     a 375px window), and a bare file path overflowed its own box by 45px (`scrollWidth` 308,
//     `clientWidth` 263). Rule 2 only scans interactive controls and rule 1 reads
//     `documentElement.scrollWidth`, which a `position: fixed` surface does not move; the overflowing
//     text was rightly absorbed by its scrolling ancestor.
//     Rule A (`offscreenNodes`): no visible element leaves the viewport (1px tolerance), unless an
//     ancestor really scrolls (overflow-x auto|scroll and scrollWidth > clientWidth + 1) or clips
//     (overflow-x hidden|clip). Zero-size, hidden and transparent nodes are skipped. It measured 0 at
//     rest on board, inbox and channel, so it enters with no declared debt.
//     Rule B (`selfOverflowNodes`): a leaf node with `overflow-x: visible` does not overflow its own
//     box. Deliberate ellipses (`overflow: hidden` + `text-overflow`) are out of scope by construction.
//  12. Each generic floating surface, opened one at a time (16/09, decision 7 of the same task).
//     select, combobox, menu and popover share one width bound (`ui/floating.ts`), so one regression
//     risk, and nothing says which one will overflow next. `auditEachFloatingSurface()` opens each
//     trigger on the page, replays rules A and B while it is open, closes it (Escape), moves on.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const pick = (mod) => mod?.chromium ?? mod?.default?.chromium;
async function loadChromium() {
  for (const dir of (process.env.NODE_PATH ?? "").split(":").filter(Boolean)) {
    try {
      const found = pick(
        await import(pathToFileURL(join(dir, "playwright-core", "index.js")).href),
      );
      if (found) return found;
    } catch {
      /* next directory */
    }
  }
  return pick(await import("playwright-core"));
}

const BASE = process.env.BASE ?? "http://localhost:5173";
const API = process.env.API ?? "http://localhost:8790";
/** iPhone 13 mini, the smallest device the operator actually uses: measuring wider would let
 *  through exactly what we are looking for. */
const VIEWPORT = { width: 375, height: 812 };
/** Minimum share of the height for content. A floor, not a target: when the rule was set, the
 *  measured routes rendered 83 %. */
const MIN_MAIN_RATIO = 0.6;
const OUT = process.env.SHOTS ?? null;

/** A page's verdict, computed in the page: boxes cannot be guessed from Node. */
const audit = () => ({
  scrollWidth: document.documentElement.scrollWidth,
  clientWidth: document.documentElement.clientWidth,
  mainHeight: Math.round(document.querySelector(".ui-main")?.getBoundingClientRect().height ?? 0),
  viewportHeight: window.innerHeight,
  unreachable: [...document.querySelectorAll("button, a[href], input, textarea, select")]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return false;
      const out = r.right > document.documentElement.clientWidth + 1 || r.left < -1;
      if (!out) return false;
      // A scrolling ancestor makes the control reachable: that separates a deliberately wide step
      // strip from a lost button.
      for (let p = el.parentElement; p; p = p.parentElement) {
        const ox = getComputedStyle(p).overflowX;
        if ((ox === "auto" || ox === "scroll") && p.scrollWidth > p.clientWidth + 1) return false;
      }
      return true;
    })
    .map((el) => `${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 40)}"`)
    .slice(0, 8),
});

/** Frame depth (14/09). DESIGN.md § 4 bans nested cards, and the one time the defect was measured
 *  (`/artifacts/iBRy6T3P5W/spec.md`) a human counted boxes by hand on one page.
 *
 *  A "sheet" is recognised by its rendering, not the `.ui-card` class (`.inbox-qz` imitated a card
 *  in CSS without the class): opaque background, a border on all four sides (a top rule alone, like
 *  the channel composer's, is a separator) and a non-zero radius. It must be at least 240×80 and
 *  cover over 85 % of its parent sheet's width: the target is a full-width frame in a full-width
 *  frame, not a tile in a grid.
 *
 *  `[data-tone]` excludes: it is how `<Inset>` and `<Banner>` declare they are the sanctioned
 *  alternative to a card. An `<Inset>` inside a card is the intended pattern (`ui/card.css`),
 *  measured on a goal page; counting it would flag the design system itself. */
const frameDepth = () => {
  const main = document.querySelector(".ui-main");
  if (!main) return [];
  const SKIP_TAGS = new Set(["BUTTON", "A", "INPUT", "TEXTAREA", "SELECT", "SVG", "IMG", "LABEL"]);
  const describe = (el) =>
    `${el.tagName.toLowerCase()}${[...el.classList].map((c) => `.${c}`).join("")}`;
  const isSheet = (el) => {
    if (!(el instanceof Element) || SKIP_TAGS.has(el.tagName)) return false;
    if (el.hasAttribute("data-tone")) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 240 || r.height < 80) return false;
    const cs = getComputedStyle(el);
    const bg = cs.backgroundColor;
    const hasBg = bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent";
    const hasBorder = ["Top", "Right", "Bottom", "Left"].every(
      (side) => parseFloat(cs[`border${side}Width`]) > 0 && cs[`border${side}Style`] !== "none",
    );
    const hasRadius = ["TopLeft", "TopRight", "BottomLeft", "BottomRight"].some(
      (corner) => parseFloat(cs[`border${corner}Radius`]) > 0,
    );
    return hasBg && hasBorder && hasRadius;
  };
  const sheets = [...main.querySelectorAll("*")].filter(isSheet);
  const chains = [];
  for (const el of sheets) {
    let outer = null;
    for (let p = el.parentElement; p && p !== main; p = p.parentElement) {
      if (isSheet(p)) {
        outer = p;
        break;
      }
    }
    if (!outer) continue;
    const innerBox = el.getBoundingClientRect();
    const outerBox = outer.getBoundingClientRect();
    if (innerBox.width / outerBox.width < 0.85) continue;
    chains.push({
      inner: describe(el),
      outer: describe(outer),
      outerLeft: Math.round(outerBox.left),
      innerLeft: Math.round(innerBox.left),
      innerRight: Math.round(innerBox.right),
    });
  }
  return chains;
};

/** Rule 8. `null` when the tab bar is not in the DOM (`TabBarSlot` renders `null` outside sections
 *  that have one): nothing to protect. */
const toastAboveTabbar = () => {
  const tabbar = document.querySelector(".app-tabbar");
  const region = document.querySelector(".ui-toast-region");
  if (!tabbar || !region) return null;
  const t = tabbar.getBoundingClientRect();
  const r = region.getBoundingClientRect();
  return { tabbarTop: Math.round(t.top), toastBottom: Math.round(r.bottom) };
};

/** Rule 9. Two visible children of `.ui-topbar` where one starts at or below the other's bottom
 *  means the bar wrapped. The report gives the measured height and the two elements. */
const topbarWrapped = () => {
  const topbar = document.querySelector(".ui-topbar");
  if (!topbar) return null;
  const topbarHeight = Math.round(topbar.getBoundingClientRect().height);
  const children = [...topbar.children].filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  if (children.length < 2) return null;

  const boxes = children.map((el) => ({
    top: Math.round(el.getBoundingClientRect().top),
    bottom: Math.round(el.getBoundingClientRect().bottom),
    className: el.className,
  }));

  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      if (b.top >= a.bottom || a.top >= b.bottom) {
        return {
          topbarHeight,
          wrapped: true,
          details: `${a.className} (${a.top}-${a.bottom}) and ${b.className} (${b.top}-${b.bottom})`,
        };
      }
    }
  }

  return { topbarHeight, wrapped: false };
};

/** Rule A (see the file header), computed in the page. Starts from `document.body`, not
 *  `documentElement`: `<html>` and `<body>` are not judged by their own rule. */
const offscreenNodes = () => {
  const vw = document.documentElement.clientWidth;
  const bad = [];
  for (const el of document.body.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") continue;
    const out = r.right > vw + 1 || r.left < -1;
    if (!out) continue;
    let excused = false;
    for (let p = el.parentElement; p; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if ((ox === "auto" || ox === "scroll") && p.scrollWidth > p.clientWidth + 1) {
        excused = true;
        break;
      }
      if (ox === "hidden" || ox === "clip") {
        excused = true;
        break;
      }
    }
    if (excused) continue;
    bad.push({
      el: `${el.tagName.toLowerCase()}${[...el.classList].map((c) => `.${c}`).join("")}`,
      left: Math.round(r.left),
      right: Math.round(r.right),
    });
  }
  return bad;
};

/** Rule B (see the file header). A leaf has no element children: bare text counts, a `<p>` holding
 *  a `<code>` does not (the `<code>` is judged instead). Only computed `overflow-x: visible` is
 *  checked; `hidden`/`auto`/`scroll` is a deliberate ellipsis or rule A's business. */
const selfOverflowNodes = () => {
  const bad = [];
  for (const el of document.body.querySelectorAll("*")) {
    if (el.children.length > 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") continue;
    if (cs.overflowX !== "visible") continue;
    if (el.scrollWidth > el.clientWidth + 1) {
      bad.push({
        el: `${el.tagName.toLowerCase()}${[...el.classList].map((c) => `.${c}`).join("")}`,
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      });
    }
  }
  return bad;
};

/** Rule 12: trigger and placed-surface selectors of the four generic floating surfaces. `popover`
 *  also gets a hover, to cover `openOn="hover"`, where its click handler does nothing. */
const FLOATING_SURFACES = [
  { name: "select", trigger: ".ui-select:not([disabled])", surface: '.ui-select-list[data-placed="true"]' },
  {
    name: "combobox",
    trigger: ".ui-combobox-input:not(:disabled)",
    surface: '.ui-combobox-list[data-placed="true"]',
  },
  { name: "menu", trigger: ".ui-menu-trigger", surface: '.ui-menu[data-placed="true"]' },
  { name: "popover", trigger: ".ui-popover-trigger", surface: '.ui-popover[data-placed="true"]' },
];

/** Triggers are queried again on each iteration: an open select lives in a portal that can reorder
 *  the DOM and invalidate a handle captured earlier. */
async function auditEachFloatingSurface(page) {
  const bad = [];
  for (const spec of FLOATING_SURFACES) {
    const count = (await page.$$(spec.trigger)).length;
    for (let i = 0; i < count; i++) {
      const el = (await page.$$(spec.trigger))[i];
      if (!el) continue;
      if (spec.name === "popover") await el.hover().catch(() => {});
      await el.click({ timeout: 2000 }).catch(() => {});
      const placed = await page.waitForSelector(spec.surface, { timeout: 800 }).catch(() => null);
      if (placed) {
        const off = await page.evaluate(offscreenNodes);
        for (const o of off)
          bad.push(
            `(${spec.name} #${i + 1} open) off screen: ${o.el} (L${o.left} R${o.right})`,
          );
        const self = await page.evaluate(selfOverflowNodes);
        for (const s of self)
          bad.push(
            `(${spec.name} #${i + 1} open) overflows its box: ${s.el} ` +
              `(scrollWidth=${s.scrollWidth} clientWidth=${s.clientWidth})`,
          );
      }
      await page.keyboard.press("Escape").catch(() => {});
    }
  }
  return bad;
}


/** Rule 4, computed after clicking the trigger. The spec's `.ui-tabbar` is the phone tab bar, whose
 *  real class is `.app-tabbar` (`app/tab-bar.css`). A zero-size control is not displayed in this
 *  state, so it is not a missed target: only controls with a box count. */
const touchAudit = () => ({
  tooShort: [
    ...document.querySelectorAll(
      ".ui-topbar button, .ui-topbar a[href], .ui-topbar input, .ui-topbar select, " +
        ".ui-topbar-tools button, .ui-topbar-tools a[href], " +
        ".app-tabbar button, .app-tabbar a[href]",
    ),
  ]
    .map((el) => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ r }) => (r.width > 0 || r.height > 0) && r.height < 44)
    .map(
      ({ el, r }) =>
        `${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 40)}" (${Math.round(r.height)}px)`,
    ),
  panelLeft:
    document.querySelector(".ui-topbar-tools[data-open]")?.getBoundingClientRect().left ?? null,
});

/** Rule 7, overlap while scrolling (16/09). Taken as is from the interview before that task
 *  (`/artifacts/8Wi5ZP25_I/spec.md` § 2): each visible text node's box is intersected with every
 *  clipping ancestor, then `elementFromPoint` is asked what is painted on top at three points. A top
 *  element that is neither the text nor an ancestor/descendant is an overlap.
 *
 *  Two false positives fixed then: a closed `<details>` keeps a queryable box under
 *  `::details-content` (`content-visibility: hidden`) that `getBoundingClientRect()` misses but
 *  `checkVisibility()` names, otherwise every closed fold of the trace would count. And an element
 *  that clips itself (`.ui-tag`) must be intersected with its own clip, not only its ancestors'. */
const overlapProbe = () => {
  const vw = document.documentElement.clientWidth,
    vh = window.innerHeight;
  const describe = (el) =>
    el ? `${el.tagName.toLowerCase()}${[...el.classList].map((c) => `.${c}`).join("")}` : "null";
  const hits = [];
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = (n.textContent ?? "").trim();
    if (!text) continue;
    const el = n.parentElement;
    if (!el) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.opacity === "0") continue;
    if (
      !el.checkVisibility({
        contentVisibilityAuto: true,
        opacityProperty: true,
        visibilityProperty: true,
      })
    )
      continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    const r = range.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    let clip = { left: 0, top: 0, right: vw, bottom: vh };
    for (let p = el; p; p = p.parentElement) {
      const pcs = getComputedStyle(p);
      if (pcs.overflow === "visible" && pcs.overflowX === "visible" && pcs.overflowY === "visible")
        continue;
      const pr = p.getBoundingClientRect();
      clip = {
        left: Math.max(clip.left, pr.left),
        top: Math.max(clip.top, pr.top),
        right: Math.min(clip.right, pr.right),
        bottom: Math.min(clip.bottom, pr.bottom),
      };
    }
    const vis = {
      left: Math.max(r.left, clip.left),
      top: Math.max(r.top, clip.top),
      right: Math.min(r.right, clip.right),
      bottom: Math.min(r.bottom, clip.bottom),
    };
    if (vis.right - vis.left < 4 || vis.bottom - vis.top < 4) continue;
    const my = (vis.top + vis.bottom) / 2;
    for (const [x, y] of [
      [(vis.left + vis.right) / 2, my],
      [vis.left + 2, my],
      [vis.right - 2, my],
    ]) {
      if (x < 0 || x > vw - 1 || y < 0 || y > vh - 1) continue;
      const top = document.elementFromPoint(x, y);
      if (!top || top === el || el.contains(top) || top.contains(el)) continue;
      const key = `${describe(el)}|${describe(top)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ text: text.slice(0, 40), covered: describe(el), by: describe(top) });
      break;
    }
  }
  return hits;
};

/** Operator token (13/09). `/api` requires a session, so without a token both requests get 401 and
 *  the pages show the sign-in screen instead of triage. Given through `LEGION_TOKEN`. */
const TOKEN = process.env.LEGION_TOKEN ?? "";
const authHeaders = TOKEN ? { authorization: `Bearer ${TOKEN}` } : {};

/** The triage routes, the ones `DESIGN.md` § Width says are designed for this breakpoint. Other
 *  routes only need to not break, and this script does not check that. */
async function routesOf() {
  // `/api/bootstrap`, not `/api/projects`: the project list has no route of its own, it comes in the
  // startup bundle the screen reads on first render.
  const res = await fetch(`${API}/api/bootstrap`, { headers: authHeaders });
  // A named 401 rather than a stack trace on `r.json()`: the first thing that happens to someone
  // running this months after setting the token once.
  if (res.status === 401)
    throw new Error(
      "the API requires an operator session. Pass the token: `LEGION_TOKEN=… make responsive`.\n" +
        "It is shown once, when the control plane that created it starts.",
    );
  const boot = await res.json();
  // Rule 9 needs the longest project name: a short one does not reproduce the top-bar defect at 375px.
  const projects = boot.projects ?? [];
  const project = projects.sort((a, b) => (b.name?.length ?? 0) - (a.name?.length ?? 0))[0];
  if (!project) throw new Error(`no project served by ${API}, nothing to measure`);
  const inbox = await fetch(`${API}/api/inbox`, { headers: authHeaders }).then((r) => r.json());
  const open = inbox.find((e) => e.projectId);
  const round = inbox.find((e) => (e.form?.blocks ?? []).some((b) => b.kind === "field"));
  // A task page is a triage route (13/09): notifications land there and approvals happen there. It
  // was missing from the first list and it broke: the two-column height model stayed armed once
  // columns stacked, `.tsk-main` fell to 0 pixels and its content overflowed the panel. Measure the
  // task with the most material (a session, so a full action bar): an empty task overflows nothing.
  const tasks = await fetch(`${API}/api/tasks`, { headers: authHeaders }).then((r) => r.json());
  const withSession = new Set((tasks.sessions ?? []).map((s) => s.taskId));
  const task = (tasks.tasks ?? []).find((t) => withSession.has(t.id) && t.projectId);
  // Two channel shapes, carried by two different tasks (16/09). The question and approval gate live
  // in `ChannelActionBand`, in addition to the thread (`/artifacts/8Wi5ZP25_I/spec.md` § 5). Using
  // `task` for both would measure the same page twice whenever it is also the waiting task (the case
  // on this seed), hence excluding tasks already covered by `open`.
  const openTaskIds = new Set(inbox.filter((e) => e.projectId).map((e) => e.taskId));
  const channelTask =
    (tasks.tasks ?? []).find(
      (t) => withSession.has(t.id) && t.projectId && !openTaskIds.has(t.id),
    ) ?? task;
  return [
    { name: "board", url: `${BASE}/p/${project.id}/board` },
    { name: "inbox", url: `${BASE}/p/${project.id}/inbox` },
    // The concierge (16/09) has no sub-navigation, but its only exit at the compact breakpoint
    // (`ConciergeTabBar`) must stay reachable: before the fix the rail was hidden, the bar absent,
    // a dead end.
    { name: "concierge", url: `${BASE}/concierge` },
    open && { name: "question", url: `${BASE}/p/${open.projectId}/inbox/${open.id}` },
    round && { name: "questionnaire", url: `${BASE}/p/${round.projectId}/inbox/${round.id}` },
    task && { name: "task", url: `${BASE}/p/${task.projectId}/tasks/${task.id}` },
    // A live task's channel. Until the richer demo seed (`/artifacts/ck80A3w9ET`) no session had
    // enough trace to scroll `.ch-conv-scroll`, so nothing showed whether the composer stayed
    // visible. Waits for nothing, to contrast with the next route.
    channelTask && {
      name: "channel",
      url: `${BASE}/p/${channelTask.projectId}/channels/${channelTask.id}`,
    },
    open && {
      name: "channel-question",
      url: `${BASE}/p/${open.projectId}/channels/${open.taskId}`,
    },
  ].filter(Boolean);
}

const chromium = await loadChromium();
const browser = process.env.BROWSER_WS_ENDPOINT
  ? await chromium.connect(process.env.BROWSER_WS_ENDPOINT)
  : await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: VIEWPORT });
if (OUT) mkdirSync(OUT, { recursive: true });

// The page must be authenticated too, not just the requests above: without a session the app
// renders the sign-in screen and we would carefully measure an input field. The cookie from this
// login is carried by the following navigations.
if (TOKEN) {
  const login = await page.request.post(`${API}/api/operator/session`, { data: { token: TOKEN } });
  if (!login.ok())
    throw new Error(`sign-in refused (${login.status()}). Is LEGION_TOKEN the right one?`);
}

const failures = [];
const routes = await routesOf();
for (const route of routes) {
  await page.goto(route.url, { waitUntil: "networkidle" });
  const m = await page.evaluate(audit);
  const floor = Math.round(m.viewportHeight * MIN_MAIN_RATIO);
  const bad = [];
  if (m.scrollWidth > m.clientWidth + 1)
    bad.push(`the document scrolls horizontally (${m.scrollWidth} > ${m.clientWidth})`);
  if (m.mainHeight < floor)
    bad.push(`content gets only ${m.mainHeight}px of ${m.viewportHeight} (floor ${floor})`);
  for (const u of m.unreachable) bad.push(`off screen with nothing scrolling to reach it: ${u}`);

  // Rule 5, before clicking the tools panel, which does not change the page body.
  const frames = await page.evaluate(frameDepth);
  for (const f of frames)
    bad.push(
      `nested card: ${f.inner} (L${f.innerLeft} R${f.innerRight}) inside ${f.outer} ` +
        `(L${f.outerLeft})`,
    );

  // Rule 8: only where the tab bar exists, no click needed.
  const toastTabbar = await page.evaluate(toastAboveTabbar);
  if (toastTabbar && toastTabbar.toastBottom > toastTabbar.tabbarTop)
    bad.push(
      `the toast covers the tab bar: region bottom ${toastTabbar.toastBottom} > ` +
        `bar top ${toastTabbar.tabbarTop}`,
    );

  // Rule 9, no click needed.
  const topbarCheck = await page.evaluate(topbarWrapped);
  if (topbarCheck && topbarCheck.wrapped)
    bad.push(
      `the top bar wrapped: height ${topbarCheck.topbarHeight}px, ` +
        `${topbarCheck.details}`,
    );

  // Rules A and B at rest (see the file header).
  const offRest = await page.evaluate(offscreenNodes);
  for (const o of offRest) bad.push(`off screen at rest: ${o.el} (L${o.left} R${o.right})`);
  const selfRest = await page.evaluate(selfOverflowNodes);
  for (const s of selfRest)
    bad.push(
      `overflows its box at rest: ${s.el} (scrollWidth=${s.scrollWidth} ` +
        `clientWidth=${s.clientWidth})`,
    );

  // Rule 12. Measuring at rest alone would have missed both defects of the task: they only existed
  // with the panel open.
  const floatingBad = await auditEachFloatingSurface(page);
  bad.push(...floatingBad);

  // Rule 7, only when the route has a `size="fill"` area that actually scrolls; elsewhere the loop
  // is empty.
  const fillScrollers = await page.evaluate(
    () =>
      [...document.querySelectorAll('.ui-scroll-view[data-size="fill"]')].filter(
        (v) => v.scrollHeight > v.clientHeight + 8,
      ).length,
  );
  if (fillScrollers > 0) {
    for (const frac of [0, 0.34, 0.67, 1]) {
      await page.evaluate((f) => {
        for (const v of document.querySelectorAll('.ui-scroll-view[data-size="fill"]')) {
          v.scrollTop = (v.scrollHeight - v.clientHeight) * f;
        }
      }, frac);
      await page.waitForTimeout(150);
      const hits = await page.evaluate(overlapProbe);
      for (const h of hits)
        bad.push(`overlap while scrolling (${frac}): "${h.text}" (${h.covered}) under ${h.by}`);
      // The composer pushed out of `.ch-conv` and clipped by its `overflow: hidden` (the first lead
      // ruled out by the interview, spec § 5): nothing is painted over it, so the overlap probe
      // sees nothing. Hence this geometric check.
      const composer = await page.evaluate(() => {
        const conv = document.querySelector(".ch-conv");
        const box = document.querySelector(".ch-conv-composer");
        if (!conv || !box) return null;
        const c = conv.getBoundingClientRect(),
          k = box.getBoundingClientRect();
        return {
          fits: k.top >= c.top - 1 && k.bottom <= c.bottom + 1,
          convBottom: Math.round(c.bottom),
          composerBottom: Math.round(k.bottom),
        };
      });
      if (composer && !composer.fits)
        bad.push(
          `composer outside .ch-conv while scrolling (${frac}): composer.bottom=` +
            `${composer.composerBottom} conv.bottom=${composer.convBottom}`,
        );
      if (OUT)
        await page.screenshot({ path: join(OUT, `compact-${route.name}-scroll-${frac}.png`) });
    }
  }

  // Rule 4: the collapsed panel is only measurable open. The trigger exists on every route.
  const toggle = await page.$(".ui-topbar-tools-toggle");
  if (toggle) {
    await toggle.click();
    await page.waitForSelector(".ui-topbar-tools[data-open]");
    const t = await page.evaluate(touchAudit);
    for (const short of t.tooShort) bad.push(`target under 44px, panel open: ${short}`);
    if (t.panelLeft !== null && t.panelLeft < 0)
      bad.push(`the open panel overflows the screen's left edge (left ${Math.round(t.panelLeft)})`);
    if (OUT) await page.screenshot({ path: join(OUT, `compact-${route.name}-panel.png`) });
    await page.keyboard.press("Escape");
  }

  // Rule 6: the project switcher's mark (`.ui-topbar-switch`) has the same box as a menu row's mark
  // (`[role="menu"] .prj-sm`).
  const switchTrigger = await page.$(".ui-topbar-switch");
  if (switchTrigger) {
    await switchTrigger.click();
    await page.waitForSelector('[role="menu"] .prj-sm');
    const marks = await page.evaluate(() => {
      const box = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { width: Math.round(r.width), height: Math.round(r.height) };
      };
      return {
        trigger: box(document.querySelector(".ui-topbar-switch .prj-sm")),
        row: box(document.querySelector('[role="menu"] .prj-sm')),
      };
    });
    if (!marks.trigger || !marks.row) {
      bad.push("project mark not found in the bar or its menu");
    } else if (
      marks.trigger.width !== marks.row.width ||
      marks.trigger.height !== marks.row.height
    ) {
      bad.push(
        `menu mark ${marks.row.width}×${marks.row.height} ≠ trigger ${marks.trigger.width}×${marks.trigger.height}`,
      );
    }
    if (OUT) await page.screenshot({ path: join(OUT, `compact-${route.name}-project-menu.png`) });
    await page.keyboard.press("Escape");
  }

  if (OUT) await page.screenshot({ path: join(OUT, `compact-${route.name}.png`) });
  if (bad.length) failures.push({ route, bad });
  console.log(
    `${bad.length ? "✗" : "✓"} ${route.name.padEnd(16)} content ${String(m.mainHeight).padStart(3)}px · ${m.unreachable.length} unreachable`,
  );
  for (const b of bad) console.log(`     ${b}`);
}

await browser.close();
console.log(
  `\n${routes.length} triage route(s) measured at ${VIEWPORT.width} × ${VIEWPORT.height}`,
);
if (failures.length) {
  console.error(`\n⛔ ${failures.length} route(s) do not hold at the compact breakpoint.`);
  process.exit(1);
}
console.log("✓ compact breakpoint holds.");
