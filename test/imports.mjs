/* Walk every module, collect what it exports, and confirm every named import
   somebody asks for actually exists. Catches the class of mistake that only
   shows up as `undefined is not a function` three minutes into a match. */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const dir = fileURLToPath(new URL('../src/', import.meta.url));
const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));

const exportsOf = {};
const importsOf = {};

for (const f of files) {
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  const ex = new Set();

  // export const/let/function/class NAME
  for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/gm))
    ex.add(m[1]);
  // export const A = 1, B = 2   (only the first is caught above; grab the rest)
  for (const m of src.matchAll(/^export\s+(?:const|let|var)\s+([^=;\n]+)=/gm)) {
    const lhs = m[1];
    if (!lhs.includes('{') && !lhs.includes('[')) {
      for (const name of lhs.split(',')) {
        const n = name.trim().split(/\s/)[0];
        if (/^[A-Za-z_$][\w$]*$/.test(n)) ex.add(n);
      }
    }
  }
  // export { a, b as c }
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm))
    for (const part of m[1].split(','))
      if (part.trim()) ex.add(part.split(/\s+as\s+/).pop().trim());

  exportsOf[f] = ex;

  const imps = [];
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"]\.\/([\w.]+)['"]/g)) {
    const names = m[1].split(',').map(s => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
    imps.push({ from: m[2], names });
  }
  // default + namespace imports we do not use, but flag them if they appear
  importsOf[f] = imps;
}

let bad = 0, unusedWarn = [];
for (const f of files) {
  for (const imp of importsOf[f]) {
    const target = imp.from.endsWith('.js') ? imp.from : imp.from + '.js';
    if (!exportsOf[target]) { console.log(`MISSING MODULE  ${f} -> ${target}`); bad++; continue; }
    for (const n of imp.names) {
      if (!exportsOf[target].has(n)) {
        console.log(`MISSING EXPORT  ${f}: '${n}' is not exported by ${target}`);
        bad++;
      }
    }
  }
}

/* imported but never used again in the file: harmless, but usually a leftover */
for (const f of files) {
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  const body = src.replace(/^import[\s\S]*?from\s*['"][^'"]+['"];?$/gm, '');
  for (const imp of importsOf[f])
    for (const n of imp.names)
      if (!new RegExp('\\b' + n.replace('$', '\\$') + '\\b').test(body))
        unusedWarn.push(`${f}: ${n} (from ${imp.from})`);
}

console.log(`\n${bad} broken import(s)`);
if (unusedWarn.length) {
  console.log(`\n${unusedWarn.length} unused import(s):`);
  for (const u of unusedWarn) console.log('  ' + u);
}
process.exit(bad ? 1 : 0);
