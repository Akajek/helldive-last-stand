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

/* ---------------------------------------------------------------------------
   Calling a function another module exports, without importing it. The check
   above cannot see this -- there is no import statement to validate -- and it is
   exactly the mistake that made hud() throw on every frame: `inCave` used, never
   imported, HUD and minimap silently gone.
   The rule is narrow on purpose: only flag a name that is CALLED, is exported by
   some other module in src/, is not imported here, and is not declared here. */
const allExports = new Map();
for (const f of files) for (const n of exportsOf[f]) {
  if (!allExports.has(n)) allExports.set(n, []);
  allExports.get(n).push(f);
}
let undef = 0;
for (const f of files) {
  const src = fs.readFileSync(path.join(dir, f), 'utf8');
  /* comments first, or a name mentioned in prose reads as a call */
  const body = src.replace(/\/\*[\s\S]*?\*\//g, ' ')
                  .replace(/^\s*\/\/.*$/gm, ' ')
                  .replace(/^import[\s\S]*?from\s*['"][^'"]+['"];?$/gm, '')
                  .replace(/^import\s*['"][^'"]+['"];?$/gm, '');
  const imported = new Set();
  for (const imp of importsOf[f]) for (const n of imp.names) imported.add(n);

  /* everything this file provides for itself: declarations, object-literal
     methods, and -- the one that matters -- parameter names, since a helper
     passed in as an argument is called exactly like an imported one */
  const local = new Set(exportsOf[f]);
  for (const m of body.matchAll(/(?:^|\s)(?:export\s+)?(?:async\s+)?(?:function|class)\s+([A-Za-z_$][\w$]*)/g))
    local.add(m[1]);
  for (const m of body.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) local.add(m[1]);
  for (const m of body.matchAll(/([A-Za-z_$][\w$]*)\s*[:=]\s*(?:function|\()/g)) local.add(m[1]);
  /* shorthand methods in an object literal: `hurt() { ... }` */
  for (const m of body.matchAll(/^\s*([A-Za-z_$][\w$]*)\s*\([^()]*\)\s*\{/gm)) local.add(m[1]);
  const KEYWORD = /^(if|for|while|switch|catch|return|function|typeof|new|do|else)$/;
  /* parameter lists, of every shape */
  const params = [];
  for (const m of body.matchAll(/(?:function\s*[A-Za-z_$\w]*|\b[A-Za-z_$][\w$]*)\s*\(([^()]*)\)\s*(?:\{|=>)/g))
    params.push(m[1]);
  for (const m of body.matchAll(/\(([^()]*)\)\s*=>/g)) params.push(m[1]);
  for (const p of params)
    for (const bit of p.split(',')) {
      const n = bit.trim().replace(/^\.\.\./, '').split(/[\s=:]/)[0];
      if (/^[A-Za-z_$][\w$]*$/.test(n) && !KEYWORD.test(n)) local.add(n);
    }

  for (const [name, from] of allExports) {
    if (imported.has(name) || local.has(name)) continue;
    if (from.length === 1 && from[0] === f) continue;
    /* called, and not as a property of something */
    const esc = name.replace(/[$]/g, '\\$');
    const re = new RegExp('(?<![.\\w$])' + esc + '\\s*\\(');
    if (re.test(body)) {
      console.log(`NOT IMPORTED   ${f}: calls '${name}()' (exported by ${from.join(', ')})`);
      undef++;
    }
  }
}
if (undef) bad += undef;

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
