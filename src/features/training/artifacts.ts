import * as tf from '@tensorflow/tfjs'
import { modelStorageUrl } from '@/ml/train'

/**
 * Saved-model housekeeping, kept out of `src/lib/db.ts`.
 *
 * D10 forbids `db.ts` from reaching anything outside IndexedDB, and importing
 * TensorFlow.js there would also drag the whole ML runtime into the initial
 * bundle by way of the project list. So `deleteProject` takes a `removeArtifact`
 * callback and this module supplies it.
 *
 * It lives in `features/training/` because the training run is what created the
 * artifact, and the same lifetime owns its removal.
 */

/**
 * Removes a saved head from the `indexeddb://` model store.
 *
 * A missing artifact is not an error. It is the normal state after a browser has
 * cleared the origin's storage, and the caller's goal — that no artifact remains —
 * is already satisfied. Throwing would make deleting a project fail for a learner
 * whose weights the browser had already evicted.
 */
export async function removeSavedModel(artifactKey: string): Promise<void> {
  try {
    await tf.io.removeModel(modelStorageUrl(artifactKey))
  } catch {
    // Intentionally swallowed; see above.
  }
}

/** The saved heads currently in the browser's model store, by key. */
export async function listSavedModels(): Promise<string[]> {
  try {
    return Object.keys(await tf.io.listModels()).map((url) => url.replace(/^indexeddb:\/\//, ''))
  } catch {
    return []
  }
}
