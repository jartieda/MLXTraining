import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as tf from '@tensorflow/tfjs'

/**
 * Loads a TensorFlow.js model from the local filesystem inside a node test.
 *
 * Plain `@tensorflow/tfjs` has HTTP and IndexedDB IO handlers but no filesystem one —
 * that lives in `@tensorflow/tfjs-node`, a native dependency this project deliberately
 * does not take (Principle VII: the browser is the only runtime that matters). Instead a
 * load router is registered for `file://`, so `src/ml/backbone.ts` keeps the
 * `loadBackbone(url, alpha)` signature from contracts/ml-core.md and knows nothing about
 * any of this.
 *
 * Registering a router rather than passing a handler into production code is the point:
 * the ML core under test is byte-identical to the one the browser runs.
 */

const FILE_PREFIX = 'file://'

function toPath(url: string): string {
  return url.startsWith(FILE_PREFIX) ? fileURLToPath(url) : url
}

function fileHandler(modelJsonPath: string): tf.io.IOHandler {
  return {
    load: () => {
      const baseDir = dirname(modelJsonPath)
      const parsed = JSON.parse(readFileSync(modelJsonPath, 'utf8')) as {
        modelTopology: unknown
        format?: string
        weightsManifest: { paths: string[]; weights: tf.io.WeightsManifestEntry[] }[]
      }

      const weightSpecs: tf.io.WeightsManifestEntry[] = []
      const buffers: Buffer[] = []

      for (const group of parsed.weightsManifest) {
        weightSpecs.push(...group.weights)
        for (const path of group.paths) {
          buffers.push(readFileSync(join(baseDir, path)))
        }
      }

      const merged = Buffer.concat(buffers)
      // `.buffer` alone would hand over Node's shared internal pool, not just this
      // model's bytes, so the byte range is sliced explicitly.
      const weightData: ArrayBuffer = merged.buffer.slice(
        merged.byteOffset,
        merged.byteOffset + merged.byteLength,
      )

      return Promise.resolve({
        modelTopology: parsed.modelTopology as NonNullable<tf.io.ModelArtifacts['modelTopology']>,
        weightSpecs,
        weightData,
        ...(parsed.format === undefined ? {} : { format: parsed.format }),
      })
    },
  }
}

/**
 * tfjs's router registry falls through to the next router when one returns null, but the
 * router type is declared as returning a non-nullable `IOHandler` — and `tf.io.IORouter`
 * is not exported as a type, so the signature is derived from the registration function.
 * `DECLINE` names the null return so it reads as "not mine" rather than as a bug.
 */
type LoadRouter = Parameters<typeof tf.io.registerLoadRouter>[0]
const DECLINE = null as unknown as tf.io.IOHandler

let registered = false

/** Idempotent: Vitest imports this from several files in one process. */
export function registerFileLoadRouter(): void {
  if (registered) return
  const router: LoadRouter = (url) => {
    const single = Array.isArray(url) ? url[0] : url
    if (typeof single !== 'string' || !single.startsWith(FILE_PREFIX)) return DECLINE
    return fileHandler(toPath(single))
  }
  tf.io.registerLoadRouter(router)
  registered = true
}

const REPO_ROOT = join(fileURLToPath(import.meta.url), '..', '..', '..')

/**
 * `file://` URL of a backbone fetched by `npm run fetch:backbone`.
 * `0.5` renders as the directory's `0.50`, which is the published artifact's own naming.
 */
export function backboneUrl(alpha: 0.25 | 0.5): string {
  const dir = alpha === 0.25 ? 'mobilenet_v1_0.25_224' : 'mobilenet_v1_0.50_224'
  return `${FILE_PREFIX}${join(REPO_ROOT, 'public', 'models', dir, 'model.json')}`
}

/**
 * Whether the weights are present. They are a 5.4 MB build asset fetched by a script, not
 * committed, so a contributor who has not run `npm run fetch:backbone` should get a named
 * skip rather than a wall of load failures.
 */
export function backboneAvailable(alpha: 0.25 | 0.5): boolean {
  return existsSync(fileURLToPath(backboneUrl(alpha)))
}

export const MISSING_BACKBONE_REASON =
  'MobileNet weights are absent. Run `npm run fetch:backbone` to fetch them.'
