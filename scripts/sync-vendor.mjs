import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const sourcePath = path.join(
  rootDir,
  'node_modules',
  'exifr',
  'dist',
  'full.umd.js'
);
const targetDir = path.join(rootDir, 'vendor', 'exifr');
const targetPath = path.join(targetDir, 'full.umd.js');

if (!existsSync(sourcePath)) {
  throw new Error(
    `Missing source bundle: ${sourcePath}. Run npm install first.`
  );
}

mkdirSync(targetDir, { recursive: true });
copyFileSync(sourcePath, targetPath);

console.log(`Synced ${path.relative(rootDir, targetPath)}`);
