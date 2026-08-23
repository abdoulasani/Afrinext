import { chromium } from "@playwright/test";

/**
 * Asserts that no page scrolls sideways, at any width Afrinext supports.
 *
 * Horizontal overflow on a phone is the most common and most damaging mobile
 * layout defect, and it is invisible in a screenshot: the page looks correct
 * until somebody's thumb drags it. So it is measured rather than eyeballed —
 * `scrollWidth > clientWidth` on the document element, at each width, against
 * a real production build.
 *
 * When a page does overflow, the elements sticking out are named, because
 * "something is 12 pixels too wide" is not a bug report.
 *
 * A deliberate horizontal scroller — the type-filter row on the explorer, for
 * instance — lives inside its own `overflow-x: auto` container. Its children
 * are reported as extending past the viewport, which is correct and expected;
 * what matters is that the DOCUMENT does not scroll. That is the assertion.
 *
 *   pnpm exec next start -p 3200
 *   node scripts/check-overflow.mjs http://127.0.0.1:3200 /fr /fr/explorer
 *
 * Pass `--shots <dir>` to also write a full-page screenshot of each
 * page/width pair. Exits non-zero if any page overflows.
 */

const WIDTHS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop", width: 1280, height: 900 },
  { name: "large", width: 1680, height: 1000 },
];

const argv = process.argv.slice(2);
const shotIndex = argv.indexOf("--shots");
const shotDir = shotIndex === -1 ? null : argv[shotIndex + 1];
const rest = shotIndex === -1 ? argv : [...argv.slice(0, shotIndex), ...argv.slice(shotIndex + 2)];
const [base, ...paths] = rest;

if (base === undefined || paths.length === 0) {
  console.error("usage: node scripts/check-overflow.mjs <base-url> <path>... [--shots <dir>]");
  process.exit(2);
}

const browser = await chromium.launch();
const problems = [];

for (const path of paths) {
  for (const size of WIDTHS) {
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
    });
    const page = await context.newPage();
    const response = await page.goto(base + path, { waitUntil: "networkidle" });

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    const culprits = await page.evaluate(() => {
      const viewport = document.documentElement.clientWidth;
      return [...document.querySelectorAll("*")]
        .filter((el) => el.getBoundingClientRect().right > viewport + 1)
        .slice(0, 4)
        .map((el) => `${el.tagName}.${(el.className?.toString?.() ?? "").slice(0, 60)}`);
    });

    if (shotDir !== null && shotDir !== undefined) {
      const slug = path.replace(/[^a-z0-9]+/gi, "_") || "root";
      await page.screenshot({ path: `${shotDir}/${slug}-${size.name}.png`, fullPage: true });
    }

    const line = `${path} @${size.width} status=${response?.status()} overflow=${overflow}`;
    console.log(line + (culprits.length > 0 ? `  wider than viewport: ${culprits.join(" | ")}` : ""));
    if (overflow > 0) problems.push(line);

    await context.close();
  }
}

await browser.close();

if (problems.length > 0) {
  console.error(`\nHORIZONTAL OVERFLOW on ${problems.length} page/width pair(s):`);
  for (const line of problems) console.error("  " + line);
  process.exit(1);
}
console.log("\nNo horizontal overflow at any width.");
