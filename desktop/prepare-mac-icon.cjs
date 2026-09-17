const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

if (process.platform !== "darwin") {
  console.error("O ícone macOS deve ser preparado em um Mac.");
  process.exit(1);
}

const projectRoot = path.join(__dirname, "..");
const source = path.join(projectRoot, "images", "isotipo.png");
const buildDirectory = path.join(projectRoot, "build");
const iconset = path.join(buildDirectory, "icon.iconset");
const output = path.join(buildDirectory, "icon.icns");

fs.rmSync(iconset, { recursive: true, force: true });
fs.mkdirSync(iconset, { recursive: true });

const variants = [
  [16, "icon_16x16.png"],
  [32, "icon_16x16@2x.png"],
  [32, "icon_32x32.png"],
  [64, "icon_32x32@2x.png"],
  [128, "icon_128x128.png"],
  [256, "icon_128x128@2x.png"],
  [256, "icon_256x256.png"],
  [512, "icon_256x256@2x.png"],
  [512, "icon_512x512.png"],
  [1024, "icon_512x512@2x.png"],
];

for (const [size, filename] of variants) {
  execFileSync("sips", [
    "-z",
    String(size),
    String(size),
    source,
    "--out",
    path.join(iconset, filename),
  ]);
}

execFileSync("iconutil", ["-c", "icns", iconset, "-o", output]);
console.log(`Ícone macOS criado em ${output}`);
