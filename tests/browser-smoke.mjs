/**
 * End-to-end smoke test for the ringtone studio.
 *
 * Serve the repository root (`npx http-server -p 4180 .`) and run
 * `npm_config_yes=1 node tests/browser-smoke.mjs`. It drives the page the way
 * a visitor on a phone would, because the parts most likely to break — which
 * files the picker accepts, what happens when the replace dialog is
 * cancelled, whether the download is real audio — are invisible to any check
 * that only reads the source.
 *
 * Playwright is not a dependency of the site. Install it where the test runs
 * (`npm i -g playwright`) and this picks it up.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    // Falls through to the global root below.
  }
  try {
    const { execSync } = await import("node:child_process");
    const root = execSync("npm root -g", { encoding: "utf8" }).trim();
    return await import(pathToFileURL(`${root}/playwright/index.mjs`).href);
  } catch {
    console.error("Playwright is not installed. `npm i -g playwright` and run this again.");
    process.exit(2);
  }
}

const { chromium } = await loadPlaywright();

const BASE = process.env.SMOKE_URL ?? "http://127.0.0.1:4180/";
const DEMO = process.env.SMOKE_AUDIO ?? fileURLToPath(new URL("./fixtures/demo.wav", import.meta.url));

const failures = [];
const log = (ok, name, extra = "") => {
  if (!ok) failures.push(name + (extra ? ` — ${extra}` : ""));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
const consoleErrors = [];
page.on("pageerror", (error) => consoleErrors.push(error.message));

const audioBytes = readFileSync(DEMO);

const reload = async () => {
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.waitForTimeout(200);
};

// --- a file with no MIME type at all, the way a phone file manager hands it
// over. A name the browser cannot guess from is what actually leaves
// `File.type` empty; give it a known extension and Chromium fills the type
// back in and the case never gets tested.
await reload();
const reportedType = await page.evaluate(() => {
  const input = document.querySelector("#file");
  return input.files.length ? input.files[0].type : null;
});
await page.locator("#file").setInputFiles({ name: "הקלטה", mimeType: "", buffer: audioBytes });
const seenType = await page.evaluate(() => document.querySelector("#file").files[0].type);
log(
  seenType === "" || seenType === "application/octet-stream",
  "fixture: the browser reports an unnameable type, as a phone file manager does",
  `type="${seenType}" (was ${reportedType})`,
);
const typelessAccepted = await page
  .waitForSelector("#work:not(.hidden)", { timeout: 30_000 })
  .then(() => true)
  .catch(() => false);
log(typelessAccepted, "upload: a file whose type the browser cannot name is accepted");

// --- audio inside a video container ---
await reload();
await page.locator("#file").setInputFiles({ name: "clip.mp4", mimeType: "video/mp4", buffer: audioBytes });
await page.waitForTimeout(600);
const videoNotRefused = !(await page.locator("#uploadError").textContent()).includes("אינו קובץ שמע");
log(videoNotRefused, "upload: a video container is not refused out of hand");

// --- a genuinely wrong file is still turned away, with the message on screen ---
await reload();
await page.locator("#file").setInputFiles({
  name: "notes.pdf",
  mimeType: "application/pdf",
  buffer: Buffer.from("%PDF-1.4 not audio"),
});
await page.waitForTimeout(400);
const errorShown = await page.locator("#uploadError").isVisible();
log(errorShown, "upload: a PDF is rejected and the reason is visible");

// --- the ordinary path ---
await reload();
await page.locator("#file").setInputFiles(DEMO);
await page.waitForSelector("#work:not(.hidden)", { timeout: 30_000 });
log(true, "upload: a normal audio file opens the studio");

const lengthBefore = await page.locator("#len").textContent();
log(Boolean(lengthBefore), "studio: a ringtone length is chosen automatically", `${lengthBefore}s`);

// --- cancelling "replace song" must not throw the song away ---
await page.locator("#replace").click();
await page.waitForTimeout(600); // the picker opens and is never answered
const studioStillUp = await page.locator("#work").isVisible();
const uploadCardHidden = await page.locator("#upload").isHidden();
log(studioStillUp && uploadCardHidden, "replace: cancelling keeps the loaded song",
  `work visible=${studioStillUp}, upload hidden=${uploadCardHidden}`);

// --- a bad replacement keeps the song that is already open ---
await page.locator("#file").setInputFiles({
  name: "broken.mp3",
  mimeType: "audio/mpeg",
  buffer: Buffer.from("this is not an mp3 at all"),
});
await page.waitForTimeout(1200);
const keptAfterBadFile = await page.locator("#work").isVisible();
log(keptAfterBadFile, "replace: a file that fails to decode keeps the previous song");
log(await page.locator("#uploadError").isVisible(), "replace: the decode failure is reported");

// --- manual trimming ---
await reload();
await page.locator("#file").setInputFiles(DEMO);
await page.waitForSelector("#work:not(.hidden)", { timeout: 30_000 });
const startBefore = await page.locator("#manualStart").inputValue();
await page.locator('[data-nudge="1"]').click();
await page.waitForTimeout(200);
const startAfter = await page.locator("#manualStart").inputValue();
log(Number(startAfter) > Number(startBefore), "editor: the +1s nudge moves the start",
  `${startBefore} -> ${startAfter}`);

await page.locator("#snapNatural").click();
await page.waitForTimeout(400);
log(Boolean(await page.locator("#manualNote").textContent()), "editor: natural-boundary snapping responds");

// --- the download is real audio ---
const [download] = await Promise.all([
  page.waitForEvent("download", { timeout: 60_000 }),
  page.locator("#download").click(),
]);
const path = await download.path();
const wav = readFileSync(path);
const header = wav.subarray(0, 4).toString("latin1") + wav.subarray(8, 12).toString("latin1");
log(header === "RIFFWAVE", "download: the file is a valid WAV", header);
let peak = 0;
for (let offset = 44; offset + 1 < wav.length; offset += 2) {
  peak = Math.max(peak, Math.abs(wav.readInt16LE(offset)) / 32768);
}
log(peak > 0.05, "download: the ringtone is not silence", `peak ${peak.toFixed(3)}`);

// --- the directory of the other tools, on the page the old links land on ---
const toolLinks = await page.locator(".more-tools a").evaluateAll((nodes) =>
  nodes.map((node) => node.getAttribute("href")),
);
log(toolLinks.length === 9, "moved: every tool on the new site is linked", `found ${toolLinks.length}`);
log(
  toolLinks.every((href) => href?.startsWith("https://shmuel-lamed.github.io/SongToNotes/#/")),
  "moved: the links point at the new site",
);
log(
  toolLinks.includes("https://shmuel-lamed.github.io/SongToNotes/#/ringtone"),
  "moved: the ringtone maker itself is among them",
);

// --- mobile layout ---
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
await mobile.goto(BASE, { waitUntil: "networkidle" });
const overflow = await mobile.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);
log(overflow <= 1, "mobile 390px: no horizontal overflow", `${overflow}px`);
await mobile.close();

log(consoleErrors.length === 0, "no uncaught page errors", consoleErrors.slice(0, 3).join(" | "));

await browser.close();
console.log(`\n${failures.length ? `${failures.length} FAILURES:\n- ` + failures.join("\n- ") : "ALL CHECKS PASSED"}`);
process.exit(failures.length ? 1 : 0);
