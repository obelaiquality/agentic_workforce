import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Electron loads the production bundle from file://, so emitted asset URLs
  // must stay relative instead of pointing at the filesystem root.
  base: "./",
  plugins: [
    // The React and Tailwind plugins are both required for Make, even if
    // Tailwind is not being actively used – do not remove them
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      // Alias @ to the src directory
      '@': path.resolve(__dirname, './src'),
    },
  },

  server: {
    watch: {
      ignored: [
        "**/.local/repos/**",
        "**/.local/repo-mirrors/**",
        "**/output/playwright/**",
        "**/dist/**",
        "**/dist-server/**",
        "**/dist-sidecar/**",
      ],
    },
  },

  // File types to support raw imports. Never add .css, .tsx, or .ts files to this.
  assetsInclude: ['**/*.svg', '**/*.csv'],
})
