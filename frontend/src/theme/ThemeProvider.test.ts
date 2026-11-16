import { afterEach, describe, expect, it } from 'vitest'
import { migrateStoredIdentity, readState } from './ThemeProvider'

/**
 * Pure migration and read logic for the theme model.
 *
 * The migration map is what stands between the model change and every
 * existing user's stored theme — if `vermilion → oni + amoled` ever
 * broke, the user would see their preference silently become something
 * else and read it as a reset, not a bug. Playwright covers the live
 * surface in `frontend/e2e/theme-ui.spec.ts`, but Playwright does not
 * run on the merge path yet (#330). These tests run in CI because
 * `migrateStoredIdentity` and `readState` are pure local-storage logic.
 */

const VISUAL_KEY = 'hellogitty-visual-theme'
const APPEARANCE_KEY = 'hellogitty-theme'

afterEach(() => {
  localStorage.clear()
})

describe('migrateStoredIdentity — pre-2b identity names to (pack, appearance)', () => {
  it('maps vermilion to oni + amoled', () => {
    localStorage.setItem(VISUAL_KEY, 'vermilion')
    migrateStoredIdentity()
    expect(localStorage.getItem(VISUAL_KEY)).toBe('oni')
    expect(localStorage.getItem(APPEARANCE_KEY)).toBe('amoled')
  })

  it('maps azure to oni + dark', () => {
    localStorage.setItem(VISUAL_KEY, 'azure')
    migrateStoredIdentity()
    expect(localStorage.getItem(VISUAL_KEY)).toBe('oni')
    expect(localStorage.getItem(APPEARANCE_KEY)).toBe('dark')
  })

  it('maps bone to oni + light', () => {
    localStorage.setItem(VISUAL_KEY, 'bone')
    migrateStoredIdentity()
    expect(localStorage.getItem(VISUAL_KEY)).toBe('oni')
    expect(localStorage.getItem(APPEARANCE_KEY)).toBe('light')
  })

  it('is idempotent — running twice is a no-op', () => {
    // The header comment claims this; the claim wants a test. If the second
    // pass somehow ran against a migrated value and rewrote it (because a
    // pack id happened to match a pre-2b name in some later refactor), a
    // visitor's theme would drift on every page load.
    localStorage.setItem(VISUAL_KEY, 'vermilion')
    migrateStoredIdentity()
    migrateStoredIdentity()
    migrateStoredIdentity()
    expect(localStorage.getItem(VISUAL_KEY)).toBe('oni')
    expect(localStorage.getItem(APPEARANCE_KEY)).toBe('amoled')
  })

  it('leaves a pack already in the new vocabulary untouched', () => {
    // A user already on `muertos + dark` must not have their theme
    // rewritten just because the migration code ran.
    localStorage.setItem(VISUAL_KEY, 'muertos')
    localStorage.setItem(APPEARANCE_KEY, 'dark')
    migrateStoredIdentity()
    expect(localStorage.getItem(VISUAL_KEY)).toBe('muertos')
    expect(localStorage.getItem(APPEARANCE_KEY)).toBe('dark')
  })
})

describe('readState — stored values to live (pack, appearance)', () => {
  it('falls an unrecognised stored pack back to no pack, not stranded', () => {
    // Absent-is-not-invalid: a value we do not understand must not leave
    // the user looking at a partially-themed page. Same rule we apply to
    // the settings pane ids.
    localStorage.setItem(VISUAL_KEY, 'some-pack-we-renamed-last-year')
    localStorage.setItem(APPEARANCE_KEY, 'dark')
    const { pack, appearance } = readState()
    expect(pack).toBe('')
    expect(appearance).toBe('dark')
  })

  it('falls stranded amoled to dark when the pack ships no amoled, and rewrites storage', () => {
    // The pure counterpart of the Playwright "switching to a pack without
    // AMOLED falls stranded appearance to Dark and rewrites storage"
    // gate. We verified it live against the templated page; it is pure
    // logic, so it belongs in CI.
    localStorage.setItem(VISUAL_KEY, 'pink')
    localStorage.setItem(APPEARANCE_KEY, 'amoled')
    const { pack, appearance } = readState()
    expect(pack).toBe('pink')
    expect(appearance).toBe('dark')
    expect(localStorage.getItem(APPEARANCE_KEY)).toBe('dark')
  })
})
