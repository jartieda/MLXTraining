/**
 * Frame identity for the explanation cache (D8).
 *
 * Split out of `FreezeFrame.tsx` because a module that exports both a component
 * and a plain function breaks fast refresh — and because US3's comparison view
 * needs the same hash for the same frame, so the two must not drift.
 */

/**
 * A fast non-cryptographic hash (FNV-1a) over the pixel bytes.
 *
 * Not cryptographic on purpose: this identifies a cache entry, it protects
 * nothing, and `crypto.subtle.digest` is async — which would make freezing a frame
 * an awaited operation for no benefit. Over 200 KB of pixels a collision is
 * vanishingly unlikely, and its cost would be showing the previous frame's heat
 * map rather than anything worse.
 *
 * Every fourth byte is skipped: alpha is 255 for every pixel of an opaque camera
 * frame, so hashing it is a quarter more work for zero entropy.
 */
export function hashFrame(data: Uint8ClampedArray): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < data.length; i += 4) {
    hash ^= data[i] ?? 0
    hash = Math.imul(hash, 0x01000193)
    hash ^= data[i + 1] ?? 0
    hash = Math.imul(hash, 0x01000193)
    hash ^= data[i + 2] ?? 0
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}
