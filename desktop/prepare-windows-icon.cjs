const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const sourcePath = path.join(projectRoot, "images", "icon-512.png");
const outputDir = path.join(projectRoot, "build");
const outputPath = path.join(outputDir, "icon.ico");
const png = fs.readFileSync(sourcePath);

// ICO can embed PNG data directly. A zero dimension in the directory entry
// represents 256 px or larger, while the embedded PNG preserves the 512 px art.
const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(1, 4);
header.writeUInt8(0, 6);
header.writeUInt8(0, 7);
header.writeUInt8(0, 8);
header.writeUInt8(0, 9);
header.writeUInt16LE(1, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(header.length, 18);

fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(outputPath, Buffer.concat([header, png]));
console.log(`Icone do Windows preparado em ${path.relative(projectRoot, outputPath)}.`);
