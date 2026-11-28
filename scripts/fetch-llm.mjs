// Prepare local ONNX models under the same origin as the lab.
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const root = fileURLToPath(new URL('../public/models/', import.meta.url))
const models = ['onnx-community/Qwen2.5-0.5B-Instruct']

const gemma4 = 'onnx-community/gemma-4-E2B-it-ONNX'
if (process.argv.includes('--gemma4')) models.push(gemma4)

async function fetchModel(id) {
  const dest = path.join(root, id)
  if (await access(path.join(dest, 'ready.json')).then(() => true, () => false)) return
  await mkdir(path.dirname(dest), { recursive: true })
  const staging = await mkdtemp(dest + '-')
  try {
    const revision = id === gemma4 ? '/revision/6f21c99d7e18237f8d2ce92aadfdbfeba877f63a' : ''
    const { stdout } = await exec('curl', ['-fsSL', '--retry', '2', 'https://huggingface.co/api/models/' + id + revision + '?blobs=true'])
    const { sha, siblings } = JSON.parse(stdout)
    const weights = id === gemma4
      ? ['onnx/embed_tokens_q4.onnx', 'onnx/embed_tokens_q4.onnx_data',
         'onnx/decoder_model_merged_q4.onnx', 'onnx/decoder_model_merged_q4.onnx_data']
      : ['onnx/model_quantized.onnx']
    const files = siblings.filter(({ rfilename }) =>
      weights.includes(rfilename) || /^(config|generation_config|tokenizer|tokenizer_config|special_tokens_map|added_tokens)\.json$/.test(rfilename))
    if (!weights.every(name => files.some(file => file.rfilename === name && file.lfs?.sha256))) throw Error('Missing weight metadata for ' + id)
    for (const { rfilename, lfs, size } of files) {
      console.log(id, rfilename)
      const target = path.join(staging, rfilename)
      await mkdir(path.dirname(target), { recursive: true })
      await exec('curl', ['-fsSL', '--retry', '2', '-o', target,
        'https://huggingface.co/' + id + '/resolve/' + sha + '/' + rfilename + '?download=true'])
      const hash = createHash('sha256')
      let bytes = 0
      for await (const chunk of createReadStream(target)) {
        bytes += chunk.length
        hash.update(chunk)
      }
      if (bytes !== size || (lfs && hash.digest('hex') !== lfs.sha256)) throw Error('Incomplete download: ' + rfilename)
    }
    await writeFile(path.join(staging, 'ready.json'), JSON.stringify({ revision: sha }))
    await rename(staging, dest)
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

await Promise.all(models.map(fetchModel))
