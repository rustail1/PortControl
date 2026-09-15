import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve, relative, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const manifestName = 'DELIVERY_CHECKSUMS.sha256';
const manifestPath = resolve(root, manifestName);
const roots = ['src', 'test', 'docs', 'scripts'];
const rootFiles = [
  '.gitattributes',
  '.gitignore',
  'AGENTS.md',
  'PROJECT_MAP.md',
  'README.md',
  'index.html',
  'package-lock.json',
  'package.json',
  'tsconfig.json',
];

function normalize(path) {
  return path.split(sep).join('/');
}

function collectDirectory(path, output) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const absolute = resolve(path, entry.name);
    if (entry.isDirectory()) collectDirectory(absolute, output);
    else if (entry.isFile()) output.push(normalize(relative(root, absolute)));
  }
}

function coveredFiles() {
  const files = [];
  for (const directory of roots) {
    const absolute = resolve(root, directory);
    if (existsSync(absolute) && statSync(absolute).isDirectory()) collectDirectory(absolute, files);
  }
  for (const file of rootFiles) {
    if (existsSync(resolve(root, file))) files.push(file);
  }
  return [...new Set(files)].sort();
}

function digest(file) {
  return createHash('sha256').update(readFileSync(resolve(root, file))).digest('hex');
}

function writeManifest() {
  const content = coveredFiles().map((file) => `${digest(file)}  ./${file}`).join('\n') + '\n';
  writeFileSync(manifestPath, content);
  console.log(`WROTE ${manifestName}: ${coveredFiles().length} files`);
}

function verifyManifest() {
  if (!existsSync(manifestPath)) throw new Error(`${manifestName} is missing`);
  const expected = new Map();
  for (const line of readFileSync(manifestPath, 'utf8').split(/\r?\n/)) {
    if (!line) continue;
    const match = /^([0-9a-f]{64})  \.\/(.+)$/.exec(line);
    if (match === null) throw new Error(`invalid checksum line: ${line}`);
    expected.set(match[2], match[1]);
  }
  const actualFiles = coveredFiles();
  const expectedFiles = [...expected.keys()].sort();
  if (actualFiles.join('\n') !== expectedFiles.join('\n')) {
    const missing = expectedFiles.filter((file) => !actualFiles.includes(file));
    const uncovered = actualFiles.filter((file) => !expected.has(file));
    throw new Error(`delivery coverage mismatch; missing=[${missing.join(', ')}] uncovered=[${uncovered.join(', ')}]`);
  }
  for (const file of actualFiles) {
    const actual = digest(file);
    if (actual !== expected.get(file)) throw new Error(`checksum mismatch: ${file}`);
  }
  console.log(`DELIVERY CHECKSUMS OK: ${actualFiles.length}/${actualFiles.length}`);
}

if (process.argv.includes('--write')) writeManifest();
else verifyManifest();
