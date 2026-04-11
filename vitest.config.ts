import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    environmentMatchGlobs: [["src/app/**/*.test.tsx", "jsdom"]],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    setupFiles: ["src/test/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts", "src/**/*.tsx"],
      exclude: [
        "src/**/*.test.ts",
        "src/**/*.test.tsx",
        "src/test/**",
        "src/**/*.d.ts",
        // Pure type/interface files — no runtime code
        "src/server/execution/types.ts",
        "src/server/commands/commandTypes.ts",
        "src/server/ide/ideBridgeTypes.ts",
        "src/server/mcp/types.ts",
        "src/server/plugins/pluginTypes.ts",
        "src/server/hooks/types.ts",
        "src/server/skills/types.ts",
        "src/server/tools/types.ts",
        "src/server/permissions/types.ts",
        "src/shared/contracts.ts",
        "src/app/lib/missionTypes.ts",
        "src/app/components/command-center/types.ts",
      ],
      reporter: ["text", "lcov", "json-summary"],
      reportsDirectory: "coverage",
    },
  },
});
