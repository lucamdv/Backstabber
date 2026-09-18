const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.join(__dirname, "..");
const outputDirectory = path.join(projectRoot, "web-dist");
const buildId =
  process.env.BACKSTABBER_BUILD_ID ||
  `${require(path.join(projectRoot, "package.json")).version}-local`;

const files = [
  "index.html",
  "game.html",
  "manifest.webmanifest",
  "sw.js",
  "background.mp4",
  "background_mobile.mp4",
];
const directories = ["css", "js", "images"];

if (!outputDirectory.startsWith(projectRoot + path.sep)) {
  throw new Error("Diretório de saída inválido.");
}

fs.rmSync(outputDirectory, { recursive: true, force: true });
fs.mkdirSync(outputDirectory, { recursive: true });

for (const file of files) {
  fs.copyFileSync(path.join(projectRoot, file), path.join(outputDirectory, file));
}

for (const directory of directories) {
  fs.cpSync(path.join(projectRoot, directory), path.join(outputDirectory, directory), {
    recursive: true,
  });
}

fs.writeFileSync(
  path.join(outputDirectory, "version.json"),
  `${JSON.stringify({ version: buildId }, null, 2)}\n`,
);

console.log(`PWA preparado em web-dist (versão ${buildId}).`);
