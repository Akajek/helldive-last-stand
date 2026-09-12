/* One-shot tidy: drop imported names that the file never mentions again.
 *
 *   node test/prune.mjs --dry     (report only)
 *   node test/prune.mjs           (rewrite)
 *
 * Detection is deliberately timid. A name is only removed when a word-boundary
 * search of the file body -- with all the import statements taken out -- finds
 * it nowhere at all. That direction of error is safe: the worst case is leaving
 * something in. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const dir = fileURLToPath(new URL('../src/', import.meta.url));
const dry = process.argv.includes('--dry');
const IMPORT = /import\s*\{([^}]*)\}\s*from\s*(['"])(\.\/[\w.]+)\2\s*;?/g;

let totalDropped = 0;
const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));
const stillImported = new Set();

for (const f of files) {
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  const body = src.replace(IMPORT, '');
  let out = src, dropped = [];

  out = src.replace(IMPORT, (whole, names, q, mod) => {
    const kept = [];
    for (const raw of names.split(',')) {
      const n = raw.trim();
      if (!n) continue;
      const local = n.split(/\s+as\s+/).pop().trim();
      const re = new RegExp('\\b' + local.replace(/\$/g, '\\$') + '\\b');
      if (re.test(body)) kept.push(n);
      else dropped.push(local + ' (' + mod + ')');
    }
    if (!kept.length) return `import '${mod}';`;     /* keep the module in the graph */
    stillImported.add(mod);
    /* re-wrap at a sensible width so the result still reads like the original */
    const one = `import { ${kept.join(', ')} } from '${mod}';`;
    if (one.length <= 92) return one;
    const lines = [];
    let cur = ' ';
    for (const k of kept) {
      if ((cur + k).length > 86) { lines.push(cur.replace(/\s+$/, '')); cur = ' '; }
      cur += ' ' + k + ',';
    }
    lines.push(cur.replace(/,\s*$/, ''));
    return `import {\n${lines.join('\n')}\n} from '${mod}';`;
  });

  if (dropped.length) {
    totalDropped += dropped.length;
    console.log(`${f}: -${dropped.length}`);
    if (!dry) fs.writeFileSync(path.join(dir, f), out);
  }
}
console.log(`\n${totalDropped} unused import name(s) ${dry ? 'found' : 'removed'}`);
