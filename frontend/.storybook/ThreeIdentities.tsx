import type { ReactNode } from 'react'
import { ThemeProvider } from '../src/theme/ThemeProvider'
import { IDENTITIES, IDENTITY_ORDER, cssVarsFor, type Identity } from '../src/theme/tokens'

/**
 * The "three identities side by side" variant.
 *
 * ADR-UI-002 §6 names three-theme coverage as a signature requirement, and the
 * gap this view makes visible is the point of the exercise: when Azure and
 * Bone have no scenic art, a single Vermilion story would never show it. Three
 * columns, one per identity, each running the same component against the same
 * data, make a missing asset self-evident in one glance.
 *
 * How the scoping works:
 *
 * ThemeProvider writes CSS custom properties onto :root. Three sibling
 * ThemeProviders racing for :root would all end up painting the same identity
 * (whichever mounted last). To keep each column truly on its own palette, each
 * column also gets inline CSS variables from cssVarsFor(identity). Inline vars
 * on a wrapping div win over :root for the subtree beneath, because `var()`
 * resolves at the use site and walks up the inheritance chain. The nested
 * ThemeProvider is kept only so `useTheme()` inside the component (for art
 * lookups, for example) returns the matching identity in each column.
 *
 * Nothing here reimplements the theme: colours still come from tokens.ts via
 * cssVarsFor, the contract contrast test still owns correctness, and each
 * column uses the real provider for context.
 */
export function ThreeIdentities({
  render,
  minWidth = 320,
}: {
  render: (identity: Identity) => ReactNode
  /** Hint for each column; the grid will widen past this if the viewport allows. */
  minWidth?: number
}) {
  return (
    <div
      style={{
        display: 'grid',
        gap: 16,
        gridTemplateColumns: `repeat(3, minmax(${minWidth}px, 1fr))`,
      }}
    >
      {IDENTITY_ORDER.map((id) => (
        <section
          key={id}
          aria-label={`${IDENTITIES[id].label} identity`}
          style={{
            ...cssVarsFor(id),
            background: 'var(--hg-canvas)',
            border: '1px solid var(--hg-line)',
            padding: 12,
            colorScheme: IDENTITIES[id].scheme,
          }}
        >
          <header
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--hg-text-muted)',
              marginBottom: 8,
            }}
          >
            {IDENTITIES[id].label}
          </header>
          <ThemeProvider>{render(id)}</ThemeProvider>
        </section>
      ))}
    </div>
  )
}
