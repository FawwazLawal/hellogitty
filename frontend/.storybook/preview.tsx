import { useEffect, type ReactNode } from 'react'
import type { Preview, Decorator } from '@storybook/react-vite'
import { ThemeProvider, useTheme, type Appearance } from '../src/theme/ThemeProvider'
import { IDENTITY_ORDER, type Identity } from '../src/theme/tokens'

// Load the real app stylesheet so Tailwind utilities, the focus ring and the
// `.hg-decor` guard are all present in every story. Without this, stories render
// unstyled even though the token layer is live.
import '../src/index.css'

/**
 * The global decorator drives the REAL ThemeProvider from the toolbar.
 *
 * ADR-UI-002 §6: every signature component has "a Storybook reference covering
 * three themes, realistic data, and key states." Phase 2 asks for a toolbar
 * that flips identity and appearance; the rule is to drive the real
 * ThemeProvider rather than reimplement theming here, so a story can never
 * drift from the app. Everything below is thin glue: context + a small
 * synchroniser that forwards toolbar globals into useTheme's setters.
 *
 * Caveats worth knowing:
 * - ThemeProvider writes to localStorage on setIdentity/setAppearance (that is
 *   the real app's behaviour). In Storybook this persists across refreshes,
 *   which is harmless but visible.
 * - The provider writes CSS custom properties to document.documentElement.
 *   The "three identities" variant uses per-column scoped vars (see
 *   decorators/ThreeIdentities.tsx) so the three panels do not race for :root.
 */

function ThemeSync({
  identity,
  appearance,
  children,
}: {
  identity: Identity
  appearance: Appearance
  children: ReactNode
}) {
  const { setIdentity, setAppearance } = useTheme()
  useEffect(() => {
    setIdentity(identity)
  }, [identity, setIdentity])
  useEffect(() => {
    setAppearance(appearance)
  }, [appearance, setAppearance])
  return <>{children}</>
}

const withTheme: Decorator = (Story, context) => {
  const identity = (context.globals.identity as Identity) ?? 'vermilion'
  const appearance = (context.globals.appearance as Appearance) ?? 'auto'
  return (
    <ThemeProvider>
      <ThemeSync identity={identity} appearance={appearance}>
        <div
          style={{
            minHeight: '100vh',
            background: 'var(--hg-canvas)',
            color: 'var(--hg-text)',
            padding: 16,
          }}
        >
          <Story />
        </div>
      </ThemeSync>
    </ThemeProvider>
  )
}

const preview: Preview = {
  parameters: {
    layout: 'fullscreen',
    controls: {
      // Expanded by default so the data arg table is obvious when a story has one.
      expanded: true,
    },
  },
  globalTypes: {
    identity: {
      description: 'Visual identity',
      toolbar: {
        title: 'Identity',
        icon: 'paintbrush',
        items: IDENTITY_ORDER.map((id) => ({ value: id, title: id[0].toUpperCase() + id.slice(1) })),
        dynamicTitle: true,
      },
    },
    appearance: {
      description: 'OS appearance',
      toolbar: {
        title: 'Appearance',
        icon: 'circlehollow',
        items: [
          { value: 'auto', title: 'Auto' },
          { value: 'light', title: 'Light' },
          { value: 'dark', title: 'Dark' },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { identity: 'vermilion', appearance: 'auto' },
  decorators: [withTheme],
}

export default preview
