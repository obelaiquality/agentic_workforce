import fs from 'node:fs';
const source = fs.readFileSync(new URL('../src/routes.js', import.meta.url), 'utf8');
const docs = fs.readFileSync(new URL('../docs/api.md', import.meta.url), 'utf8');
if (!source.includes('createTaskHandler')) throw new Error('createTaskHandler missing');
if (!/POST \/tasks/.test(docs)) throw new Error('POST /tasks docs missing');
console.log('fastify-api-lite verification passed');
