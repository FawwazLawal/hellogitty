import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * Tailwind v4 is registered as a Vite plugin, not via PostCSS.
 *
 * It was missing until the first render: `@tailwindcss/vite` was in
 * package.json and `@import 'tailwindcss'` was in index.css, but the plugin was
 * never added here. The result was not a blank page — the base theme layer
 * still resolved, so colours and fonts looked plausible while every utility
 * class silently did nothing. The first screenshot showed a clock bracket SVG
 * scaled to fill the viewport, because `h-12 w-6` was inert.
 *
 * Worth naming, because it is the same shape as the bug that made the CSS pack
 * look like it had no art: a thing that is present, referenced, and not wired
 * up fails by doing nothing rather than by erroring, and nothing in a type
 * check or a test catches that. Only rendering it does.
 */
export default defineConfig({
  plugins: [react(), tailwindcss()],
})
