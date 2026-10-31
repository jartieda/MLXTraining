import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repositoryRoot = new URL('../../', import.meta.url)
const netlifyConfig = readFileSync(fileURLToPath(new URL('netlify.toml', repositoryRoot)), 'utf8')
const nginxConfig = readFileSync(
  fileURLToPath(new URL('docker/nginx-security-headers.conf', repositoryRoot)),
  'utf8',
)

describe('WebLLM deployment network policy', () => {
  it.each([
    ['Netlify', netlifyConfig],
    ['Docker Nginx', nginxConfig],
  ])('%s allows connections from any origin for model downloads', (_name, config) => {
    expect(config).toMatch(/connect-src\s+\*/)
  })
})
