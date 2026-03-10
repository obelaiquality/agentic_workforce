import "dotenv/config";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  log: ["warn", "error"],
});

function normalizeWhitespace(input) {
  return input
    .replace(/\r/g, "\n")
    .replace(/\u000c/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractDocxText(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`File not found: ${resolved}`);
  }

  const raw = execFileSync("textutil", ["-convert", "txt", "-stdout", resolved], {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });

  return normalizeWhitespace(raw);
}

function chunkParagraphs(text, maxChars = 2400) {
  const paragraphs = text
    .split(/\n\s*\n/g)
    .map((item) => item.trim())
    .filter(Boolean);

  const chunks = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length <= maxChars) {
      current = next;
      continue;
    }

    if (current) {
      chunks.push(current);
    }

    if (paragraph.length <= maxChars) {
      current = paragraph;
      continue;
    }

    for (let index = 0; index < paragraph.length; index += maxChars) {
      chunks.push(paragraph.slice(index, index + maxChars));
    }
    current = "";
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function inferSourceLabel(filePath) {
  const name = path.basename(filePath, path.extname(filePath)).toLowerCase();
  if (name.includes("memory")) {
    return "academic-memory";
  }
  if (name.includes("paradigm")) {
    return "academic-paradigms";
  }
  if (name.includes("architecture")) {
    return "academic-architecture";
  }
  return "academic-reference";
}

async function importFile(filePath) {
  const resolved = path.resolve(filePath);
  const source = inferSourceLabel(resolved);
  const text = extractDocxText(resolved);
  const chunks = chunkParagraphs(text);

  await prisma.knowledgeIndexMetadata.deleteMany({
    where: {
      source,
      path: resolved,
    },
  });

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    await prisma.knowledgeIndexMetadata.create({
      data: {
        source,
        path: resolved,
        snippet: chunk,
        score: Math.max(0.45, Number((1 - index * 0.015).toFixed(3))),
        embeddingId: `docx:${path.basename(resolved)}:${index + 1}`,
      },
    });
  }

  return {
    filePath: resolved,
    source,
    chunks: chunks.length,
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.error("Usage: node scripts/knowledge/import_docx_refs.mjs <file.docx> [file.docx ...]");
    process.exit(1);
  }

  const results = [];
  for (const filePath of args) {
    results.push(await importFile(filePath));
  }

  console.log(JSON.stringify({ ok: true, items: results }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
