import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const unpackedDir = path.join(distDir, "firefox");
const artifactName = "AvatarInspector-firefox.xpi";
const artifactPath = path.join(distDir, artifactName);

const filesToCopy = [
  "manifest.json",
  "background.js",
  "content.js",
  "popup.html",
  "popup.js",
  "rules.json",
  "vendor/exifr/full.umd.js"
];

for (const relativePath of filesToCopy) {
  const absolutePath = path.join(rootDir, relativePath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Missing required file: ${relativePath}`);
  }
}

rmSync(unpackedDir, { recursive: true, force: true });
rmSync(artifactPath, { force: true });
mkdirSync(unpackedDir, { recursive: true });

for (const relativePath of filesToCopy) {
  const sourcePath = path.join(rootDir, relativePath);
  const targetPath = path.join(unpackedDir, relativePath);
  mkdirSync(path.dirname(targetPath), { recursive: true });
  cpSync(sourcePath, targetPath, { recursive: true });
}

execFileSync("zip", ["-rq", artifactPath, "."], {
  cwd: unpackedDir,
  stdio: "inherit"
});

console.log(`Built ${path.relative(rootDir, artifactPath)}`);
