import fs from 'node:fs';
const script = fs.readFileSync(new URL('./smoke.js', import.meta.url), 'utf8');
const docs = fs.readFileSync(new URL('../docs/runbook.md', import.meta.url), 'utf8');
if (!script.includes('smokeCheck')) throw new Error('smokeCheck missing');
if (!/recovery step/i.test(docs)) throw new Error('recovery steps missing');
console.log('ops-runbook-lite verification passed');
