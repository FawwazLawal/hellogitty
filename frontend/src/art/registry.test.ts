import { describe, expect, it } from 'vitest'
import { readdirSync, existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { ASSETS, ASSET_INDEX, resolveArt, artUrl } from './index'

/**
 * The both-directions check that keeps the registry honest.
 *
 * ONE: every registered asset must exist on disk. Without this, the
 * registry is a wish list and the component still 404s — the original
 * failure mode. If `header-azure.webp` is deleted but the registry still
 * names it, this test goes red with that exact filename.
 *
 * TWO: every file in public/art/ must be registered. Without this, dead
 * files accumulate — commits add a new variant, forget to remove the old
 * one, and nothing complains until a release is being audited and nobody
 * can explain what `vermilion-sketch-v2.webp` is for.
 *
 * Both directions matter and both are enforced here. A one-direction
 * check is the shape that lets a broken state masquerade as working.
 *
 * Proven red: on first write I temporarily renamed `header-azure.webp` to
 * `.off`, ran `vitest run`, and this suite reported "registered asset
 * header-azure.webp is missing from public/art/" — exactly the shape a
 * reviewer needs. File renamed back; suite green again.
 */

// Resolve public/art/ relative to THIS test file rather than process.cwd(),
// so the suite does not drift if a future script runs it from a different
// working directory.
const PUBLIC_ART = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'art')

describe('art registry: every registered asset exists on disk', () => {
  for (const asset of ASSETS) {
    it(`${asset.identity}:${asset.slot} → ${asset.file}`, () => {
      const path = join(PUBLIC_ART, asset.file)
      expect(existsSync(path), `registered asset ${asset.file} is missing from public/art/`).toBe(true)
      // And it is a file, not an empty placeholder.
      expect(statSync(path).size, `${asset.file} is zero bytes — the file is a placeholder, not a real asset`).toBeGreaterThan(0)
    })
  }
})

describe('art registry: every file on disk is registered', () => {
  const onDisk = readdirSync(PUBLIC_ART)
    .filter((f) => f.endsWith('.webp'))
    .sort()

  it('finds the public/art directory', () => {
    // If this fails, every other row would report a misleading "missing
    // asset" — anchor the directory existence explicitly.
    expect(existsSync(PUBLIC_ART), `public/art/ not found at ${PUBLIC_ART}`).toBe(true)
  })

  const registeredFiles = new Set(ASSETS.map((a) => a.file))
  // Include responsive variants once the registry grows them.
  for (const a of ASSETS) {
    for (const v of a.responsiveVariants) registeredFiles.add(v.file)
  }

  for (const file of onDisk) {
    it(`${file} is declared in the registry`, () => {
      expect(
        registeredFiles.has(file),
        `${file} exists in public/art/ but is not declared in the registry — ` +
          `either add an AssetRecord for it in src/art/registry.ts or remove the file.`,
      ).toBe(true)
    })
  }
})

describe('art registry: the index is consistent', () => {
  it('has one entry per array row (no silent overwrites)', () => {
    expect(ASSET_INDEX.size).toBe(ASSETS.length)
  })

  it('round-trips every (identity, slot) through resolveArt', () => {
    for (const a of ASSETS) {
      const r = resolveArt(a.identity, a.slot)
      expect(r.kind).toBe('present')
      if (r.kind === 'present') {
        expect(r.url).toBe(`/art/${a.file}`)
        expect(r.intrinsic).toEqual(a.intrinsic)
      }
    }
  })

  it('returns a typed "absent" for an unregistered pair, not a broken URL', () => {
    // bone has no mascot or empty today. The resolver must say so
    // explicitly, with a reason a reviewer can grep for.
    const r = resolveArt('bone', 'mascot')
    expect(r.kind).toBe('absent')
    if (r.kind === 'absent') {
      expect(r.reason).toContain('bone')
      expect(r.reason).toContain('mascot')
    }
    // And the narrow convenience returns null, not a URL.
    expect(artUrl('bone', 'mascot')).toBeNull()
    expect(artUrl('azure', 'empty')).toBeNull()
  })

  it('never fabricates a URL from an identity/slot pair that has no asset', () => {
    // The exact failure the loader was built to prevent: URL interpolation
    // produced /art/header-azure.webp when nothing was registered for it.
    // Even if a filename COULD exist on disk, the resolver's "absent" arm
    // must be the only way to arrive at a URL.
    const r = resolveArt('azure', 'empty')
    if (r.kind === 'present') {
      throw new Error('azure:empty should be absent; registry shipped art for it unexpectedly')
    }
  })
})
