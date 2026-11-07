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

  /*
   * Build straight into web/app, which the Go binary embeds.
   *
   * ADR-UI-002 §7 Phase 2 ends with "Verify Go can serve built assets locally
   * without Node at runtime", and that is the sentence that makes the stack
   * "wired in" rather than merely installed. Writing into the embed directory
   * rather than frontend/dist means there is no copy step to forget, and no
   * way for the binary to ship a stale build while the source looks current.
   *
   * `base` is /app/ because the app mounts under that prefix: the Go service
   * keeps serving the existing dashboard at / throughout the migration, which
   * is the "safe legacy path" Phase 3 asks for. Without this, every asset URL
   * in the built index.html would be absolute from / and 404.
   */
  base: '/app/',
  build: {
    outDir: '../web/app',
    emptyOutDir: true,
  },
})
