export interface ReminderMessage {
  role: "user";
  content: string;
}

export interface ReminderConfig {
  intervalMessages: number;  // inject every N messages, default 10
  maxReminderTokens: number; // max tokens per reminder, default 200
}

export interface BlueprintPolicies {
  testingRequired?: boolean;
  docsRequired?: boolean;
  protectedPaths?: string[];
  approvalRequired?: string[];
  maxChangedFiles?: number;
}

const DEFAULT_CONFIG: ReminderConfig = {
  intervalMessages: 10,
  maxReminderTokens: 200,
};

export function buildBaseReminder(policies?: BlueprintPolicies, maxReminderTokens = DEFAULT_CONFIG.maxReminderTokens): string {
  const parts: string[] = [
    "[System Reminder] Follow the established edit format strictly. Verify changes compile before completing.",
  ];

  if (policies?.testingRequired) {
    parts.push("Tests are REQUIRED for behavior changes.");
  }
  if (policies?.docsRequired) {
    parts.push("Update documentation when user-facing behavior changes.");
  }
  if (policies?.protectedPaths && policies.protectedPaths.length > 0) {
    parts.push(`Protected paths (require approval): ${policies.protectedPaths.join(", ")}`);
  }
  if (policies?.maxChangedFiles) {
    parts.push(`Review required if changing more than ${policies.maxChangedFiles} files.`);
  }

  let result = parts.join(" ");

  // Estimate tokens as text.length / 4; truncate if over budget
  const maxChars = maxReminderTokens * 4;
  if (result.length > maxChars) {
    result = result.slice(0, maxChars - 3) + "...";
  }

  return result;
}

export function buildErrorReminder(): string {
  return "[System Reminder] A tool error occurred. Check the error message carefully. If the same approach has failed multiple times, try an alternative strategy.";
}

export function buildEditReminder(): string {
  return "[System Reminder] After editing files, verify the changes are correct. Run tests if available. Ensure the edit doesn't break existing functionality.";
}

export function buildJsonFormatReminder(): string {
  return "[System Reminder] The next response MUST be valid JSON. Do not include commentary, markdown, or explanation outside the JSON object.";
}

export function shouldInjectReminder(messageCount: number, config?: Partial<ReminderConfig>): boolean {
  const interval = config?.intervalMessages ?? DEFAULT_CONFIG.intervalMessages;
  return messageCount > 0 && messageCount % interval === 0;
}

export function injectReminders(input: {
  messages: Array<{ role: string; content: string }>;
  trigger: "interval" | "error" | "edit" | "json_format";
  policies?: BlueprintPolicies;
  config?: Partial<ReminderConfig>;
}): Array<{ role: string; content: string }> {
  const { messages, trigger, policies, config } = input;

  let reminderContent: string;
  switch (trigger) {
    case "interval":
      reminderContent = buildBaseReminder(policies, config?.maxReminderTokens);
      break;
    case "error":
      reminderContent = buildErrorReminder();
      break;
    case "edit":
      reminderContent = buildEditReminder();
      break;
    case "json_format":
      reminderContent = buildJsonFormatReminder();
      break;
  }

  return [...messages, { role: "user", content: reminderContent }];
}
