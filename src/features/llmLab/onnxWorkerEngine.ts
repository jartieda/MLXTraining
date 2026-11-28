import type { RawLlmEngine } from './llmEngine'
import type { LabModelId } from './webllm'

export type OnnxRequest =
  | { type: 'load'; model: LabModelId }
  | { type: 'generate'; args: Parameters<RawLlmEngine['generate']> }
  | { type: 'tokens'; args: Parameters<RawLlmEngine['nextTokenAlternatives']> }
  | { type: 'interrupt' }

type OnnxReply = { progress: number } | { result: unknown } | { error: string }

export async function createOnnxWorkerEngine(
  model: LabModelId,
  onProgress: (progress: number) => void,
): Promise<RawLlmEngine> {
  const worker = new Worker(new URL('./onnx.worker.ts', import.meta.url), { type: 'module' })
  // serialize() allows one outstanding inference. Interrupt messages have no reply.
  let pending: { resolve(value: unknown): void; reject(error: Error): void } | undefined
  let closed: Error | undefined

  function close(error: Error) {
    closed = error
    pending?.reject(error)
    pending = undefined
    worker.terminate()
  }

  worker.onerror = event => close(new Error(event.message || 'ONNX worker failed'))
  worker.onmessageerror = () => close(new Error('Invalid ONNX worker message'))
  worker.onmessage = ({ data }: MessageEvent<OnnxReply>) => {
    if ('progress' in data) {
      onProgress(data.progress)
      return
    }
    if ('error' in data) pending?.reject(new Error(data.error))
    else pending?.resolve(data.result)
    pending = undefined
  }

  function request<T>(message: OnnxRequest): Promise<T> {
    if (closed) return Promise.reject(closed)
    return new Promise((resolve, reject) => {
      pending = { resolve: value => resolve(value as T), reject }
      worker.postMessage(message)
    })
  }

  try {
    await request({ type: 'load', model })
  } catch (error) {
    worker.terminate()
    throw error
  }
  return {
    backend: model === 'gemma4' ? 'gpu' : 'cpu',
    generate: (...args) => request({ type: 'generate', args }),
    nextTokenAlternatives: (...args) => request({ type: 'tokens', args }),
    interrupt: () => worker.postMessage({ type: 'interrupt' }),
    unload() {
      close(new Error('ONNX model unloaded'))
      return Promise.resolve()
    },
  }
}
