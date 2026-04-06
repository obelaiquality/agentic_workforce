import { useEffect } from "react";

type Modifier = "meta" | "ctrl" | "alt" | "shift";
type ShortcutOptions = {
  key: string;
  modifiers?: Modifier[];
  handler: (e: KeyboardEvent) => void;
  enabled?: boolean;
};

function matchModifiers(e: KeyboardEvent, modifiers: Modifier[]): boolean {
  const want = new Set(modifiers);
  if (want.has("meta") !== e.metaKey) return false;
  if (want.has("ctrl") !== e.ctrlKey) return false;
  if (want.has("alt") !== e.altKey) return false;
  if (want.has("shift") !== e.shiftKey) return false;
  return true;
}

export function useKeyboardShortcut(options: ShortcutOptions) {
  useEffect(() => {
    if (options.enabled === false) return;

    const listener = (e: KeyboardEvent) => {
      // Skip if user is typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.target as HTMLElement)?.isContentEditable) return;

      if (e.key === options.key && matchModifiers(e, options.modifiers ?? [])) {
        e.preventDefault();
        options.handler(e);
      }
    };

    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [options.key, options.modifiers, options.handler, options.enabled]);
}

export function useKeyboardShortcuts(shortcuts: ShortcutOptions[]) {
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.target as HTMLElement)?.isContentEditable) return;

      for (const shortcut of shortcuts) {
        if (shortcut.enabled === false) continue;
        if (e.key === shortcut.key && matchModifiers(e, shortcut.modifiers ?? [])) {
          e.preventDefault();
          shortcut.handler(e);
          return;
        }
      }
    };

    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [shortcuts]);
}
