import type { SlashCommandDefinition } from "./commandTypes";

// ---------------------------------------------------------------------------
// Command Registry — manages slash command definitions
// ---------------------------------------------------------------------------

export class CommandRegistry {
  private commands = new Map<string, SlashCommandDefinition>();
  private aliasMap = new Map<string, string>();

  /** Register a slash command. Throws if a duplicate name or alias exists. */
  register(command: SlashCommandDefinition): void {
    if (this.commands.has(command.name)) {
      throw new Error(`Command already registered: ${command.name}`);
    }
    if (this.aliasMap.has(command.name)) {
      throw new Error(`Command name conflicts with an existing alias: ${command.name}`);
    }

    this.commands.set(command.name, command);

    if (command.aliases) {
      for (const alias of command.aliases) {
        if (this.commands.has(alias)) {
          throw new Error(`Alias "${alias}" conflicts with an existing command name`);
        }
        if (this.aliasMap.has(alias)) {
          throw new Error(`Alias "${alias}" is already registered`);
        }
        this.aliasMap.set(alias, command.name);
      }
    }
  }

  /**
   * Resolve a slash command input string.
   * E.g. "/commit -m fix bug" → { command, args: "-m fix bug" }
   * Returns null if the input is not a slash command or not recognized.
   */
  resolve(input: string): { command: SlashCommandDefinition; args: string } | null {
    if (!this.isSlashCommand(input)) {
      return null;
    }

    const trimmed = input.trim();
    const spaceIndex = trimmed.indexOf(" ", 1);
    const commandName = spaceIndex === -1
      ? trimmed.slice(1)
      : trimmed.slice(1, spaceIndex);
    const args = spaceIndex === -1 ? "" : trimmed.slice(spaceIndex + 1).trim();

    // Direct match
    const direct = this.commands.get(commandName);
    if (direct) {
      return { command: direct, args };
    }

    // Alias match
    const canonical = this.aliasMap.get(commandName);
    if (canonical) {
      const command = this.commands.get(canonical);
      if (command) {
        return { command, args };
      }
    }

    return null;
  }

  /** List all registered commands. */
  listCommands(): SlashCommandDefinition[] {
    return Array.from(this.commands.values());
  }

  /** Check if an input string is a slash command (starts with /). */
  isSlashCommand(input: string): boolean {
    return input.trim().startsWith("/");
  }

  /** Get the number of registered commands. */
  get size(): number {
    return this.commands.size;
  }
}
