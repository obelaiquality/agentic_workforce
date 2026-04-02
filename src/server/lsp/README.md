# LSP Integration

Language Server Protocol (LSP) integration for code intelligence in the agentic coding application.

## Overview

The LSP client provides language-aware code analysis by communicating with language servers. This enables agents to:

- Get diagnostics (errors, warnings, hints) from real language servers
- Navigate to symbol definitions
- Find all references to symbols
- Extract document symbols (functions, classes, etc.)

## Architecture

```
┌─────────────────┐
│   LSP Tools     │  (lsp_diagnostics, lsp_definition, etc.)
└────────┬────────┘
         │
         v
┌─────────────────┐
│   LSPClient     │  (JSON-RPC 2.0 over stdio)
└────────┬────────┘
         │
         v
┌─────────────────┐
│  Language       │  (typescript-language-server, pylsp, rust-analyzer, etc.)
│  Servers        │
└─────────────────┘
```

## Supported Languages

| Language   | Extension(s)                    | Server Command                        | Installation                  |
| ---------- | ------------------------------- | ------------------------------------- | ----------------------------- |
| TypeScript | .ts, .tsx, .js, .jsx, .mjs, .cjs | `npx typescript-language-server --stdio` | `npm i -g typescript-language-server` |
| Python     | .py, .pyi                       | `pylsp`                               | `pip install python-lsp-server`       |
| Rust       | .rs                             | `rust-analyzer`                       | `rustup component add rust-analyzer`  |
| Go         | .go                             | `gopls`                               | `go install golang.org/x/tools/gopls` |

## LSP Client

### Starting a Server

```typescript
import { LSPClient } from "./lspClient";

const client = new LSPClient();
await client.startServer("typescript", "/path/to/worktree");
```

The client automatically:
- Spawns the language server process
- Performs the LSP handshake (initialize/initialized)
- Handles stdout/stderr streams
- Parses JSON-RPC messages with Content-Length headers
- Manages request/response correlation

### Getting Diagnostics

```typescript
const diagnostics = await client.getDiagnostics("/path/to/file.ts");

for (const diag of diagnostics) {
  console.log(`${diag.severity} at line ${diag.line}: ${diag.message}`);
}
```

Diagnostics are cached and updated via `textDocument/publishDiagnostics` notifications.

### Finding Definitions

```typescript
const location = await client.getDefinition("/path/to/file.ts", 10, 5);

if (location) {
  console.log(`Definition at ${location.file}:${location.line}:${location.character}`);
}
```

### Finding References

```typescript
const references = await client.getReferences("/path/to/file.ts", 10, 5);

for (const ref of references) {
  console.log(`Reference at ${ref.file}:${ref.line}:${ref.character}`);
}
```

### Getting Document Symbols

```typescript
const symbols = await client.getDocumentSymbols("/path/to/file.ts");

for (const symbol of symbols) {
  console.log(`${symbol.kind} ${symbol.name} at line ${symbol.line}`);
}
```

### Cleanup

```typescript
// Stop a specific server
await client.stopServer("typescript");

// Stop all servers
await client.stopAll();
```

## LSP Tools

Four tools are available to agents via the tool system:

### 1. `lsp_diagnostics`

Get diagnostics for a file.

**Input:**
- `path` (string): Absolute path to the file

**Output:**
```
Diagnostics for /path/to/file.ts:

Errors (2):
  Line 10, Col 5: Cannot find name 'foo' [typescript]
  Line 15, Col 12: Type 'string' is not assignable to type 'number' [typescript]

Warnings (1):
  Line 20, Col 3: Unused variable 'bar' [typescript]
```

### 2. `lsp_definition`

Find definition of a symbol.

**Input:**
- `path` (string): Absolute path to the file
- `line` (number): Line number (0-indexed)
- `character` (number): Character position (0-indexed)

**Output:**
```
Definition found at:
  File: /path/to/other-file.ts
  Line: 42
  Character: 8
```

### 3. `lsp_references`

Find all references to a symbol.

**Input:**
- `path` (string): Absolute path to the file
- `line` (number): Line number (0-indexed)
- `character` (number): Character position (0-indexed)

**Output:**
```
Found 5 reference(s):
  /path/to/file1.ts:10:5
  /path/to/file2.ts:22:12
  /path/to/file3.ts:8:3
  /path/to/file4.ts:15:7
  /path/to/file5.ts:30:4
```

### 4. `lsp_symbols`

Get all symbols in a file.

**Input:**
- `path` (string): Absolute path to the file

**Output:**
```
Symbols in /path/to/file.ts:

Function (3):
  createUser (line 10)
  deleteUser (line 25)
  updateUser (line 40)

Class (1):
  UserService (line 5)

Variable (2):
  config (line 3)
  logger (line 4)
```

## Protocol Details

The LSP client implements JSON-RPC 2.0 over stdio as per the LSP specification.

### Message Format

All messages use Content-Length headers:

```
Content-Length: 123\r\n
\r\n
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}
```

### Request/Response Correlation

Requests are assigned monotonically increasing IDs. Responses include the matching ID:

```typescript
// Request
{ "jsonrpc": "2.0", "id": 1, "method": "textDocument/definition", "params": {...} }

// Response
{ "jsonrpc": "2.0", "id": 1, "result": {...} }
```

### Notifications

Notifications have no ID and expect no response:

```typescript
{ "jsonrpc": "2.0", "method": "textDocument/didOpen", "params": {...} }
```

### Implemented LSP Methods

| Method                        | Type         | Purpose                        |
| ----------------------------- | ------------ | ------------------------------ |
| `initialize`                  | Request      | Handshake                      |
| `initialized`                 | Notification | Handshake complete             |
| `shutdown`                    | Request      | Prepare to exit                |
| `exit`                        | Notification | Terminate server               |
| `textDocument/didOpen`        | Notification | File opened                    |
| `textDocument/didChange`      | Notification | File changed                   |
| `textDocument/didSave`        | Notification | File saved                     |
| `textDocument/publishDiagnostics` | Notification | Server sends diagnostics   |
| `textDocument/definition`     | Request      | Go to definition               |
| `textDocument/references`     | Request      | Find references                |
| `textDocument/documentSymbol` | Request      | Get symbols                    |

## Error Handling

The LSP client handles errors gracefully:

- **Server crashes**: Pending requests are rejected with an error
- **Timeouts**: Requests timeout after 30 seconds
- **Parse errors**: Malformed messages are logged but don't crash the client
- **Server not found**: Returns helpful error messages about missing servers

## Configuration

Server configurations are defined in `serverConfigs.ts`:

```typescript
{
  language: "typescript",
  extensions: [".ts", ".tsx", ".js", ".jsx"],
  command: ["npx", "typescript-language-server", "--stdio"],
  capabilities: {
    diagnostics: true,
    definition: true,
    references: true,
    documentSymbol: true,
  }
}
```

To add a new language:

1. Add a server config to `LSP_SERVER_CONFIGS`
2. Ensure the language server is installed
3. The tools will automatically work for files with matching extensions

## Testing

```bash
npm run test -- lspClient.test.ts
```

## Future Enhancements

- [ ] Workspace symbols (project-wide symbol search)
- [ ] Hover information (tooltips)
- [ ] Code actions (quick fixes)
- [ ] Completion (autocomplete)
- [ ] Rename (refactoring)
- [ ] Formatting (prettier-style)
- [ ] Call hierarchy
- [ ] Type hierarchy
- [ ] Inlay hints
- [ ] Semantic tokens (syntax highlighting)
