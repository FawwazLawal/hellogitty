import type { StorybookConfig } from '@storybook/react-vite'

/**
 * Storybook config, Phase 2 of ADR-UI-002.
 *
 * Framework is @storybook/react-vite, which reuses the project's own
 * vite.config.ts (so the @tailwindcss/vite plugin applies here too). That was
 * worth paying attention to — a missing plugin lets base styles resolve while
 * every utility class silently does nothing, so stories would look plausibly
 * themed and have no spacing. Inheriting the real Vite config avoids that.
 *
 * Stories live next to the component they describe (src/components/*.stories.tsx).
 */
const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(tsx|mdx)'],
  framework: { name: '@storybook/react-vite', options: {} },
  // Core Storybook 10 is plugin-free by default; the toolbar globals in
  // preview.tsx and the `withTheme` decorator are all the controls we need.
  addons: [],
}

export default config
