#!/usr/bin/env node
/**
 * R1: self-host the MobileNet v1 backbone instead of fetching it from Google at runtime.
 *
 * Two reasons, both load-bearing:
 *   - R14's Content-Security-Policy limits connect-src to the Supabase project and no
 *     other origin, so a runtime fetch from storage.googleapis.com would be blocked.
 *     The CSP is a second, independent enforcement of Principle I.
 *   - A classroom with a poor connection should not depend on a third party being up.
 *
 * Fetches the Layers ("layers-model") variant, NOT the graph model: gradcam needs to
 * slice the network with tf.model({inputs, outputs}), which cannot be done to a graph
 * model. Getting this wrong produces a confusing failure much later, so the script
 * checks the format up front.
 */

import { mkdir, writeFile, readFile, access } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_ROOT = join(ROOT, 'public', 'models')

// alpha 0.50 is the default (512-dim embedding); 0.25 is the low-end fallback for the
// reference Chromebook, chosen in R1.
const ALPHAS = ['0.50', '0.25']
const BASE = 'https://storage.googleapis.com/tfjs-models/tfjs'

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function fetchTo(url, destination) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`GET ${url} -> ${response.status} ${response.statusText}`)
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  await writeFile(destination, bytes)
  return bytes.length
}

async function fetchAlpha(alpha) {
  const name = `mobilenet_v1_${alpha}_224`
  const outDir = join(OUT_ROOT, name)
  await mkdir(outDir, { recursive: true })

  const manifestPath = join(outDir, 'model.json')
  if (await exists(manifestPath)) {
    console.log(`  ${name}: already present, skipping`)
    return
  }

  const manifestUrl = `${BASE}/${name}/model.json`
  console.log(`  ${name}: fetching manifest`)
  await fetchTo(manifestUrl, manifestPath)

  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))

  if (!manifest.modelTopology?.model_config && !manifest.modelTopology?.config) {
    throw new Error(
      `${name} does not look like a Layers model. gradcam requires a Layers model so the ` +
        `network can be truncated at a convolutional layer (R1, contracts/ml-core.md).`,
    )
  }

  const shards = (manifest.weightsManifest ?? []).flatMap((group) => group.paths ?? [])
  if (shards.length === 0) {
    throw new Error(`${name}: manifest declares no weight shards`)
  }

  let total = 0
  for (const shard of shards) {
    total += await fetchTo(`${BASE}/${name}/${shard}`, join(outDir, shard))
  }
  console.log(`  ${name}: ${shards.length} shard(s), ${(total / 1024 / 1024).toFixed(1)} MiB`)
}

console.log(`Fetching MobileNet v1 backbones into public/models/`)
for (const alpha of ALPHAS) {
  await fetchAlpha(alpha)
}
console.log('Done. public/models/ is gitignored - re-run this after a fresh clone.')
