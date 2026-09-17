// Measurement for the "discussion mode" relay, the verification gate of that task.
//
// What no code review proves: the channel and the Interview tab render the same thread (a hard
// condition of D9ter). It opens both stories, counts the thread's objects and compares their text
// segment by segment. It also checks the design contract (32 px controls, no horizontal overflow)
// and drops screenshots in the artifacts folder.
//
// The story ids and the French labels matched below predate the English UI and the renamed stories:
// they no longer match anything.
import { hostname } from "node:os";
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

const PORT = Number(process.env.PORT ?? 6007);
const BASE = process.env.BROWSER_WS_ENDPOINT
  ? `http://${hostname()}:${PORT}`
  : `http://localhost:${PORT}`;
const OUT = process.env.SHOTS ?? "/tmp/shots";
mkdirSync(OUT, { recursive: true });

const chromium = await loadChromium();
const browser = await chromium.connect(process.env.BROWSER_WS_ENDPOINT);
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

/** The rendered thread, reduced to what must be identical across surfaces. */
const readThread = () =>
  page.evaluate(() => {
    const norm = (s) => (s ?? "").replace(/\s+/g, " ").trim();
    const messages = [...document.querySelectorAll(".ch-msg")].map((m) => ({
      who: m.dataset.who,
      body: norm(m.querySelector(".ch-msg-body")?.textContent).slice(0, 160),
    }));
    return {
      messages,
      rounds: document.querySelectorAll(".ch-round, .ch-round-answered").length,
      work: document.querySelectorAll(".ch-work").length,
      notices: document.querySelectorAll(".ch-notice").length,
    };
  });

const open = async (id) => {
  await page.goto(`${BASE}/iframe.html?id=${id}&viewMode=story`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
};

const report = [];
const say = (line) => {
  report.push(line);
  console.log(line);
};

// 1. One source, two renderings.
await open("channels-channelthread--sans-formulaire-vivant");
const channel = await readThread();
await page.screenshot({ path: join(OUT, "thread-channel.png"), fullPage: true });

await open("interviews-interviewtab--deux-rounds");
const tab = await readThread();
await page.screenshot({ path: join(OUT, "thread-tab.png"), fullPage: true });

const same = JSON.stringify(channel) === JSON.stringify(tab);
say(
  `CHANNEL thread: ${channel.messages.length} messages, ${channel.rounds} rounds, ${channel.work} work bands, ${channel.notices} notices`,
);
say(
  `TAB thread:     ${tab.messages.length} messages, ${tab.rounds} rounds, ${tab.work} work bands, ${tab.notices} notices`,
);
say(`identical: ${same ? "YES" : "NO"}`);
if (!same) {
  say(JSON.stringify({ channel, tab }, null, 2));
}

// 2. The exit gesture: present, never disabled, and its reason as text.
await open("interviews-interviewexit--a-cote-du-formulaire");
const exit = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("button")].find((b) =>
    b.textContent.includes("Conclure"),
  );
  const r = btn?.getBoundingClientRect();
  const doc = document.documentElement;
  return {
    present: Boolean(btn),
    disabled: btn?.disabled ?? null,
    title: btn?.getAttribute("title"),
    height: r ? Math.round(r.height) : null,
    reasonVisible: [...document.querySelectorAll(".ui-text")].some((t) =>
      t.textContent.includes("sans attendre que l'agent"),
    ),
    counter:
      [...document.querySelectorAll(".ui-text")]
        .map((t) => t.textContent)
        .find((t) => /round\(s\) tenu\(s\)/.test(t)) ?? null,
    overflowX: doc.scrollWidth - doc.clientWidth,
  };
});
await page.screenshot({ path: join(OUT, "interview-exit.png"), fullPage: true });
say(
  `exit: present=${exit.present} disabled=${exit.disabled} title=${exit.title ?? "none"} height=${exit.height}px reason-as-text=${exit.reasonVisible}`,
);
say(`round counter: ${exit.counter}`);
say(`horizontal overflow: ${exit.overflowX}px`);

// 3. The Grants card reads the server's catalogue.
await open("agents-agentpermissions--catalogue-qui-s-elargit");
const web = await page.evaluate(() => {
  // A tool's row carries its level before its name ("R", "RW"): look for the name in the checkbox
  // label, not at the start of the row's text.
  const line = (name) => {
    const el = [...document.querySelectorAll("li.ui-perm")].find(
      (li) => [...li.querySelectorAll("input")].length > 0 && li.textContent.includes(name),
    );
    return el
      ? {
          rendered: true,
          checked: Boolean(el.querySelector("input:checked")),
          outsideAllowlist: el.textContent.includes("hors liste blanche"),
        }
      : { rendered: false };
  };
  return {
    tools: document.querySelectorAll("li.ui-perm input").length,
    WebSearch: line("WebSearch"),
    WebFetch: line("WebFetch"),
  };
});
await page.screenshot({ path: join(OUT, "grants-catalogue.png"), fullPage: true });
say(
  `Grants card (wider catalogue, ${web.tools} boxes): WebSearch=${JSON.stringify(web.WebSearch)} WebFetch=${JSON.stringify(web.WebFetch)}`,
);

// Same agent with the old catalogue (without the two web tools): the defect being fixed.
await open("agents-agentpermissions--entree-hors-catalogue");
const before = await page.evaluate(() => {
  const el = [...document.querySelectorAll("li.ui-perm")].find((li) =>
    li.textContent.includes("WebFetch"),
  );
  return el
    ? {
        checked: Boolean(el.querySelector("input:checked")),
        outsideAllowlist: el.textContent.includes("hors liste blanche"),
      }
    : { rendered: false };
});
say(`Grants card (catalogue without web tools): WebFetch=${JSON.stringify(before)}`);

// 4. Control heights on the touched surfaces.
for (const id of [
  "interviews-interviewexit--a-cote-du-formulaire",
  "interviews-interviewtab--deux-rounds",
]) {
  await open(id);
  const heights = await page.evaluate(() => {
    const seen = new Map();
    for (const el of document.querySelectorAll(
      "button.ui-btn, input.ui-input, .ui-select-trigger",
    )) {
      const h = Math.round(el.getBoundingClientRect().height);
      seen.set(h, (seen.get(h) ?? 0) + 1);
    }
    return [...seen.entries()].sort((a, b) => b[1] - a[1]);
  });
  say(
    `control heights · ${id}: ${heights.map(([h, n]) => `${h}px ×${n}`).join(", ") || "no control"}`,
  );
}

await page.close();
await browser.close();
console.log(`\nscreenshots in ${OUT}`);
