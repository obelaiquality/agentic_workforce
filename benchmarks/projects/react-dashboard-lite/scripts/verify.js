import fs from 'node:fs';
const source = fs.readFileSync(new URL('../src/dashboard.js', import.meta.url), 'utf8');
const docs = fs.readFileSync(new URL('../docs/usage.md', import.meta.url), 'utf8');
if (!source.includes('renderFilterSummary')) throw new Error('renderFilterSummary missing');
if (!/keyboard shortcut/i.test(docs)) throw new Error('keyboard shortcut docs missing');
console.log('react-dashboard-lite verification passed');
