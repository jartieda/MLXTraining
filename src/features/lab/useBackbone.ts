import { useEffect } from 'react'
import { initBackend } from '@/ml/backend'
import { loadBackbone, warmUp } from '@/ml/backbone'
import type { Alpha } from '@/ml/types'
import { useLab } from './labStore'

/**
 * Loads the backbone on entry to the lab.
 *
 * The import of `@/ml/backbone` reaches TensorFlow.js, which is why this hook —
 * and everything that uses it — sits behind the lazy `lab` route (T034). SC-008
 * gives the first route three seconds on a mid-range phone, and the runtime plus
 * a 5.4 MB backbone does not fit in that budget for a visitor who is only reading
 * the landing page.
 *
 * `warmUp` runs one throwaway pass afterwards so the shader-compilation cost is
 * paid here, behind a "getting ready" message, rather than on the first frame a
 * learner is actually watching.
 *
 * **The dependency list is `[alpha]` and nothing else, deliberately.** An earlier
 * version also depended on the `backboneLoading` flag it sets, which deadlocked:
 * setting the flag re-ran the effect, the cleanup cancelled the in-flight load,
 * and the re-run saw the flag already true and returned immediately — leaving the
 * lab stuck on "checking what this device can do" forever, with the upload and
 * capture controls permanently disabled behind it. Store values are read through
 * `getState()` inside the effect for the same reason: reading them through the
 * hook would put every unrelated store change into this dependency list.
 */

const BACKBONE_PATHS: Readonly<Record<Alpha, string>> = {
  0.25: '/models/mobilenet_v1_0.25_224/model.json',
  // `0.50` in the path, `0.5` as the TypeScript literal — the published artifact
  // is named with the trailing zero and `0.50` is not a distinct number literal.
  0.5: '/models/mobilenet_v1_0.50_224/model.json',
}

export function backboneUrl(alpha: Alpha): string {
  return `${import.meta.env.BASE_URL.replace(/\/$/, '')}${BACKBONE_PATHS[alpha]}`
}

export function useBackbone(alpha: Alpha): void {
  useEffect(() => {
    if (useLab.getState().backbone?.alpha === alpha) return

    let cancelled = false
    useLab.getState().setBackboneLoading(true)
    useLab.getState().setBackboneError(null)

    void (async () => {
      try {
        // Never throws: a device with broken WebGL gets a slower lab, not a blank
        // screen (FR-047, SC-012).
        const report = await initBackend()
        if (cancelled) return
        useLab.getState().setBackend(report)

        const loaded = await loadBackbone(backboneUrl(alpha), alpha)
        if (cancelled) {
          // The learner left, or changed the detail level again, while this was in
          // flight. Disposing here rather than storing it is what stops a second
          // 5.4 MB of weights being held by nobody.
          loaded.dispose()
          return
        }

        // Stored before the warm-up, with the loading flag still set: the backbone
        // is usable at this point, and holding it back until the throwaway pass
        // finishes would delay the first capture for no reason.
        useLab.getState().setBackbone(loaded, true)
        await warmUp(loaded)
      } catch (error) {
        // Surfaced, not swallowed. There is no degraded mode to fall back to: an
        // embedding is computed for every sample at capture time (D4), so a lab
        // without a backbone can neither photograph nor upload. Two disabled
        // buttons and no explanation is the worst possible presentation of that.
        if (!cancelled) {
          useLab
            .getState()
            .setBackboneError(error instanceof Error ? error.message : String(error))
        }
      } finally {
        if (!cancelled) useLab.getState().setBackboneLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [alpha])
}
