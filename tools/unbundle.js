#!/usr/bin/env node
// One-time extractor for design-tool bundle exports (e.g. setupguide.html).
// Pulls the real page template + assets out of the self-extracting bundle:
//   - images  -> docs/assets/images/setupguide/NN-slug.{jpg,png}
//   - fonts   -> docs/assets/fonts/Shuttleblock-{weight}.otf (from inline @font-face)
//   - styles  -> <outdir>/style-N.css (one per <style> block, for manual assembly)
//   - body    -> <outdir>/guide-body.html (uuid srcs rewritten, svg attrs fixed)
// Template bindings ({{ ... }}, <sc-for>) are left in place — port those by hand.
//
// usage: node tools/unbundle.js <bundle.html> <outdir>

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const [, , bundlePath, outDir] = process.argv;
if (!bundlePath || !outDir) {
  console.error("usage: node tools/unbundle.js <bundle.html> <outdir>");
  process.exit(1);
}
const docsDir = path.resolve(path.dirname(bundlePath));
const imgDir = path.join(docsDir, "assets", "images", "setupguide");
const fontDir = path.join(docsDir, "assets", "fonts");
fs.mkdirSync(imgDir, { recursive: true });
fs.mkdirSync(fontDir, { recursive: true });
fs.mkdirSync(outDir, { recursive: true });

const bundle = fs.readFileSync(bundlePath, "utf8");

function extractScript(type) {
  const marker = `<script type="__bundler/${type}">`;
  const start = bundle.indexOf(marker);
  if (start === -1) throw new Error(`missing ${type} block`);
  const contentStart = start + marker.length;
  const end = bundle.indexOf("</scr" + "ipt>", contentStart);
  return bundle.slice(contentStart, end);
}

const manifest = JSON.parse(extractScript("manifest"));
let template = JSON.parse(extractScript("template"));

// --- images: name by first-seen alt text, in order of appearance ---
const slugify = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "img";
const imgOrder = [];
const altByUuid = {};
const imgRe = /<img[^>]+>/g;
let m;
while ((m = imgRe.exec(template))) {
  const tag = m[0];
  const src = /src="([0-9a-f-]{36})"/.exec(tag);
  if (!src) continue;
  const uuid = src[1];
  if (!altByUuid[uuid]) {
    const alt = /alt="([^"]*)"/.exec(tag);
    altByUuid[uuid] = (alt && alt[1]) || "img";
    imgOrder.push(uuid);
  }
}

let count = 0;
const pathByUuid = {};
for (const uuid of imgOrder) {
  const entry = manifest[uuid];
  if (!entry || !/^image\//.test(entry.mime)) continue;
  count += 1;
  const ext = entry.mime === "image/png" ? "png" : "jpg";
  const name = `${String(count).padStart(2, "0")}-${slugify(altByUuid[uuid])}.${ext}`;
  fs.writeFileSync(path.join(imgDir, name), Buffer.from(entry.data, "base64"));
  pathByUuid[uuid] = `assets/images/setupguide/${name}`;
  console.log(`image  ${name}  (${entry.mime})`);
}

// warn about manifest images never referenced in the template
for (const [uuid, entry] of Object.entries(manifest)) {
  if (/^image\//.test(entry.mime) && !pathByUuid[uuid]) {
    console.warn(`unreferenced image in manifest, skipped: ${uuid} (${entry.mime})`);
  }
}

// rewrite uuid references to file paths
for (const [uuid, p] of Object.entries(pathByUuid)) {
  template = template.split(uuid).join(p);
}

// --- fonts: pull base64 OTFs out of inline @font-face blocks ---
const faceRe = /@font-face\{[^}]*?font-family:\s*'([^']+)'[^}]*?base64,([^)]+)\)[^}]*?font-weight:\s*(\d+)[^}]*?\}/g;
while ((m = faceRe.exec(template))) {
  const [, family, b64, weight] = m;
  const file = `${family.replace(/\s+/g, "")}-${weight}.otf`;
  fs.writeFileSync(path.join(fontDir, file), Buffer.from(b64, "base64"));
  console.log(`font   ${file}`);
}

// --- mechanical HTML fixes ---
template = template.replace(/sc-camel-view-box=/g, "viewBox=");

// --- split styles and body ---
const styleRe = /<style>([\s\S]*?)<\/style>/g;
let i = 0;
while ((m = styleRe.exec(template))) {
  fs.writeFileSync(path.join(outDir, `style-${i}.css`), m[1]);
  console.log(`style  style-${i}.css  (${m[1].length} chars)`);
  i += 1;
}

const bodyStart = template.indexOf('<div class="tg-doc"');
const bodyEnd = template.indexOf("</x-dc>");
if (bodyStart === -1 || bodyEnd === -1) throw new Error("could not locate guide body");
const body = template.slice(bodyStart, bodyEnd).trimEnd();
fs.writeFileSync(path.join(outDir, "guide-body.html"), body + "\n");
console.log(`body   guide-body.html  (${body.length} chars)`);
console.log("done — port {{ ... }} bindings and <sc-for> blocks by hand.");
