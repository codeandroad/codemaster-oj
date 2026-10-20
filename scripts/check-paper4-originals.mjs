#!/usr/bin/env node
// Read-only release check: generated question-paper assets are intentionally not in Git.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePaper4OriginalManifest, paper4OriginalStatement } from '../apps/web/src/components/paper4/paper4-original-question-model.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const catalogRoot = path.join(root, 'content/paper4-pastpapers');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const invariant = (condition, message) => { if (!condition) throw new Error(message); };
const usage = 'Usage: npm run check:paper4-originals -- [--assets-dir PATH] [--base-url http://127.0.0.1:3000]';

async function remoteBytes(url, limit) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(15_000), cache: 'no-store' });
  invariant(response.ok, `HTTP ${response.status} for ${url.pathname}`);
  invariant(response.body && Number(response.headers.get('content-length') ?? 0) <= limit, `Oversized or empty response: ${url.pathname}`);
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) {
        await reader.cancel();
        throw new Error(`Oversized response: ${url.pathname}`);
      }
      chunks.push(Buffer.from(chunk.value));
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks);
}

async function main() {
  let assetsDir = path.join(root, 'apps/web/public/paper4-originals');
  let baseUrl;
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--help') { console.log(usage); return; }
    invariant(['--assets-dir', '--base-url'].includes(argument) && args[index + 1] && !args[index + 1].startsWith('--'), usage);
    const value = args[++index];
    if (argument === '--assets-dir') assetsDir = path.resolve(value);
    else {
      baseUrl = new URL(value);
      invariant(['http:', 'https:'].includes(baseUrl.protocol) && !baseUrl.username && !baseUrl.password && !baseUrl.search && !baseUrl.hash && baseUrl.pathname === '/', 'Use an HTTP(S) origin without credentials, query or path for --base-url.');
    }
  }

  const catalog = JSON.parse(await readFile(path.join(catalogRoot, 'catalog.json'), 'utf8'));
  invariant(Array.isArray(catalog.papers) && catalog.papers.length > 0, 'Paper catalog is empty.');
  const keys = new Set();
  const errors = [];
  let questions = 0;
  let assets = 0;
  for (const entry of catalog.papers) {
    try {
      invariant(/^9618_[sw]\d{2}_4[123]$/.test(entry.key) && !keys.has(entry.key), 'Invalid or duplicate catalog paper key.');
      keys.add(entry.key);
      invariant(/^\d{4}\/9618_[sw]\d{2}_4[123]\.json$/.test(entry.path), 'Invalid catalog paper path.');
      const paper = JSON.parse(await readFile(path.join(catalogRoot, entry.path), 'utf8'));
      const bytes = await readFile(path.join(assetsDir, entry.key, 'manifest.json'));
      invariant(bytes.byteLength <= 262_144, 'Manifest exceeds the viewer limit.');
      const manifest = parsePaper4OriginalManifest(JSON.parse(bytes.toString('utf8')), entry.key);
      invariant(manifest, 'Manifest fails the same validation used by the student viewer.');
      invariant(manifest.sourceSha256 === entry.sourceChecksums.qp, 'Original PDF fingerprint does not match the catalog.');
      invariant(JSON.stringify(Object.keys(manifest.questions).sort()) === JSON.stringify(paper.questions.map(question => question.key).sort()), 'Manifest question keys differ from the authored paper.');
      const files = new Map([['manifest.json', bytes]]);
      const pdf = await readFile(path.join(assetsDir, entry.key, manifest.pdf));
      invariant(pdf.subarray(0, 5).toString() === '%PDF-' && hash(pdf) === manifest.sourceSha256, 'Original PDF is absent, corrupt or from a different paper.');
      files.set(manifest.pdf, pdf);
      for (const question of paper.questions) {
        const original = manifest.questions[question.key];
        invariant(original.statementSha256 === hash(paper4OriginalStatement(question.statement)), `${question.key}: statement fingerprint differs; the viewer would fall back to text.`);
        for (const segment of [...original.stem, ...original.parts.flatMap(part => part.segments)]) {
          if (files.has(segment.src)) continue;
          const image = await readFile(path.join(assetsDir, entry.key, segment.src));
          invariant(image.length >= 20 && image.subarray(0, 4).toString() === 'RIFF' && image.subarray(8, 12).toString() === 'WEBP' && image.readUInt32LE(4) + 8 === image.length, `${segment.src}: invalid or truncated WebP.`);
          files.set(segment.src, image);
        }
      }
      if (baseUrl) {
        // Keep network load bounded, and compare actual bodies rather than accepting a 200 HTML fallback.
        const entries = [...files.entries()];
        for (let start = 0; start < entries.length; start += 4) {
          await Promise.all(entries.slice(start, start + 4).map(async ([name, expected]) => {
            const actual = await remoteBytes(new URL(`/paper4-originals/${entry.key}/${name}`, baseUrl), Math.max(expected.byteLength + 1024, 262_144));
            invariant(hash(actual) === hash(expected), `Deployed asset differs from verified local asset: ${entry.key}/${name}`);
          }));
        }
      }
      questions += paper.questions.length;
      assets += files.size;
    } catch (error) {
      errors.push(`${entry.key}: ${error.message}`);
    }
  }
  if (errors.length) {
    console.error(`FAIL: ${errors.length} of ${catalog.papers.length} Paper 4 original asset sets are incomplete or mismatched.`);
    for (const error of errors) console.error(`- ${error}`);
    console.error('Generate the original question assets before building the web image; see docs/paper4-original-view.md. No files or data were changed.');
    process.exitCode = 1;
    return;
  }
  console.log(`PASS: ${catalog.papers.length} papers, ${questions} questions, ${assets} files; PDF fingerprints, statement bindings and WebP files verified${baseUrl ? `; deployed bytes match at ${baseUrl.origin}` : ''}.`);
}

await main().catch(error => { console.error(error.message); process.exitCode = 1; });
