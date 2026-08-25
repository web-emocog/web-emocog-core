import { readFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = new URL(".", import.meta.url).pathname;
const manifest = JSON.parse(await readFile(join(ROOT, "screens/manifest.json"), "utf8"));

if (manifest.length !== 61) {
  throw new Error(`Expected 61 SVG files, found ${manifest.length}`);
}

const counts = {};
for (const item of manifest) {
  const svg = await readFile(join(ROOT, item.file), "utf8");
  const expectedViewBox = item.size === "mobile" ? "0 0 390 844" : "0 0 1440 900";

  if (!svg.includes(`viewBox="${expectedViewBox}"`)) {
    throw new Error(`Wrong viewBox: ${item.file}`);
  }
  if (/<(?:image|script|foreignObject)\b|(?:href|xlink:href)=/.test(svg)) {
    throw new Error(`External or embedded dependency: ${item.file}`);
  }
  counts[`${item.audience}-${item.size}`] = (counts[`${item.audience}-${item.size}`] ?? 0) + 1;
}

function luminance(hex) {
  const channels = hex
    .replace("#", "")
    .match(/\w\w/g)
    .map(value => parseInt(value, 16) / 255)
    .map(value => value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(foreground, background) {
  const first = luminance(foreground);
  const second = luminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

const contrastPairs = [
  ["text/canvas", "#062D2E", "#F2F6F4", 4.5],
  ["muted/canvas", "#4F6B6A", "#F2F6F4", 4.5],
  ["brand/white", "#006B66", "#FFFFFF", 4.5],
  ["white/brand", "#FFFFFF", "#006B66", 4.5],
  ["white/data", "#FFFFFF", "#2563EB", 4.5],
  ["white/danger", "#FFFFFF", "#B42318", 4.5],
  ["success/subtle", "#067647", "#DCFAE6", 4.5],
  ["danger/subtle", "#B42318", "#FEE4E2", 4.5],
  ["warning/subtle", "#B45309", "#FFF3C4", 4.5],
  ["control/white", "#789692", "#FFFFFF", 3]
];

const contrastResults = contrastPairs.map(([name, foreground, background, minimum]) => {
  const ratio = contrast(foreground, background);
  if (ratio < minimum) {
    throw new Error(`${name}: ${ratio.toFixed(2)} is below ${minimum}:1`);
  }
  return `${name} ${ratio.toFixed(2)}:1`;
});

console.log(JSON.stringify({
  files: manifest.length,
  counts,
  contrast: contrastResults
}, null, 2));
