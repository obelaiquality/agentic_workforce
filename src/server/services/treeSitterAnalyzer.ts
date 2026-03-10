/**
 * Tree-sitter based code analysis — optional enhancement over regex-based extraction.
 *
 * If tree-sitter and language grammars are installed, this module provides
 * AST-accurate symbol and import extraction. Otherwise, it exports null
 * implementations and the codeGraphService falls back to regex.
 *
 * To enable: npm install tree-sitter tree-sitter-typescript tree-sitter-javascript tree-sitter-python
 */

interface TreeSitterParser {
  setLanguage(lang: unknown): void;
  parse(source: string): { rootNode: TreeSitterNode };
}

interface TreeSitterNode {
  type: string;
  text: string;
  namedChildren: TreeSitterNode[];
  childForFieldName(name: string): TreeSitterNode | null;
  descendantsOfType(type: string | string[]): TreeSitterNode[];
}

interface TreeSitterModule {
  Parser: new () => TreeSitterParser;
  languages: Map<string, unknown>;
}

let treeSitter: TreeSitterModule | null = null;
let loadAttempted = false;

async function loadTreeSitter(): Promise<TreeSitterModule | null> {
  if (loadAttempted) return treeSitter;
  loadAttempted = true;

  try {
    const ParserModule = await import("tree-sitter");
    const Parser = ParserModule.default || ParserModule;
    const languages = new Map<string, unknown>();

    try {
      const tsLang = await import("tree-sitter-typescript");
      const tsModule = tsLang.default || tsLang;
      languages.set("typescript", tsModule.typescript || tsModule);
      if (tsModule.tsx) {
        languages.set("tsx", tsModule.tsx);
      }
    } catch {
      // tree-sitter-typescript not installed
    }

    try {
      const jsLang = await import("tree-sitter-javascript");
      languages.set("javascript", jsLang.default || jsLang);
    } catch {
      // tree-sitter-javascript not installed
    }

    try {
      const pyLang = await import("tree-sitter-python");
      languages.set("python", pyLang.default || pyLang);
    } catch {
      // tree-sitter-python not installed
    }

    if (languages.size === 0) {
      return null;
    }

    treeSitter = { Parser, languages };
    return treeSitter;
  } catch {
    return null;
  }
}

function resolveLanguageKey(language: string | null): string | null {
  if (!language) return null;
  const lower = language.toLowerCase();
  if (lower === "typescript" || lower === "tsx") return lower;
  if (lower === "javascript" || lower === "jsx") return "javascript";
  if (lower === "python") return "python";
  return null;
}

export async function extractSymbolsTreeSitter(
  language: string | null,
  content: string
): Promise<string[] | null> {
  const ts = await loadTreeSitter();
  if (!ts) return null;

  const langKey = resolveLanguageKey(language);
  if (!langKey) return null;

  const grammarLang = ts.languages.get(langKey);
  if (!grammarLang) return null;

  try {
    const parser = new ts.Parser();
    parser.setLanguage(grammarLang);
    const tree = parser.parse(content);
    const names = new Set<string>();

    const declarationTypes = [
      "function_declaration",
      "method_definition",
      "class_declaration",
      "variable_declarator",
      "export_statement",
      "function_definition",  // Python
      "class_definition",     // Python
    ];

    for (const node of tree.rootNode.descendantsOfType(declarationTypes)) {
      const nameNode = node.childForFieldName("name");
      if (nameNode && nameNode.text) {
        names.add(nameNode.text);
      }
    }

    return Array.from(names).slice(0, 64);
  } catch {
    return null;
  }
}

export async function extractImportsTreeSitter(
  language: string | null,
  content: string
): Promise<string[] | null> {
  const ts = await loadTreeSitter();
  if (!ts) return null;

  const langKey = resolveLanguageKey(language);
  if (!langKey) return null;

  const grammarLang = ts.languages.get(langKey);
  if (!grammarLang) return null;

  try {
    const parser = new ts.Parser();
    parser.setLanguage(grammarLang);
    const tree = parser.parse(content);
    const imports = new Set<string>();

    const importTypes = [
      "import_statement",
      "import_from_statement",  // Python
    ];

    for (const node of tree.rootNode.descendantsOfType(importTypes)) {
      const source = node.childForFieldName("source");
      if (source) {
        const text = source.text.replace(/^["']|["']$/g, "");
        if (text) imports.add(text);
      }
      const module = node.childForFieldName("module_name");
      if (module && module.text) {
        imports.add(module.text);
      }
    }

    return Array.from(imports).slice(0, 64);
  } catch {
    return null;
  }
}

export function isTreeSitterAvailable(): boolean {
  return treeSitter !== null;
}

export async function checkTreeSitterSupport(): Promise<{
  available: boolean;
  languages: string[];
}> {
  const ts = await loadTreeSitter();
  return {
    available: ts !== null,
    languages: ts ? Array.from(ts.languages.keys()) : [],
  };
}
