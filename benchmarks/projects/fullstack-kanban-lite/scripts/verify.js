import fs from 'node:fs';
const api = fs.readFileSync(new URL('../api/tasks.js', import.meta.url), 'utf8');
const ui = fs.readFileSync(new URL('../ui/board.js', import.meta.url), 'utf8');
const docs = fs.readFileSync(new URL('../docs/board.md', import.meta.url), 'utf8');
if (!api.includes('transitionTask')) throw new Error('transitionTask missing');
if (!ui.includes('applyOptimisticMove')) throw new Error('applyOptimisticMove missing');
if (!/rollback/i.test(docs)) throw new Error('rollback docs missing');
console.log('fullstack-kanban-lite verification passed');
