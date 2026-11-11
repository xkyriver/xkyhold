// The page's side of the conversation with the engine: turns method calls
// into messages and messages back into promises.

import { EngineError } from './errors'
import type { EngineApi, Method, Progress, Request, Response } from './host'

export interface CallOptions {
  onProgress?: (progress: Progress) => void
  signal?: AbortSignal
}

export interface Transport {
  post(message: Request): void
  /** Registers the single listener for messages from the engine. */
  listen(onMessage: (message: Response) => void): void
}

interface Waiting {
  resolve(value: unknown): void
  reject(error: Error): void
  onProgress?: (progress: Progress) => void
  cleanup(): void
}

export class EngineClient {
  private readonly waiting = new Map<number, Waiting>()
  private nextId = 1

  constructor(private readonly transport: Transport) {
    transport.listen((message) => this.receive(message))
  }

  setToken(token: string | null): void {
    this.transport.post({ type: 'token', token })
  }

  call<M extends Method>(
    method: M,
    args: Parameters<EngineApi[M]>[0],
    options: CallOptions = {},
  ): Promise<ReturnType<EngineApi[M]>> {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const onAbort = () => this.transport.post({ type: 'abort', id })
      options.signal?.addEventListener('abort', onAbort)
      this.waiting.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        onProgress: options.onProgress,
        cleanup: () => options.signal?.removeEventListener('abort', onAbort),
      })
      this.transport.post({ type: 'call', id, method, args })
      if (options.signal?.aborted) onAbort()
    })
  }

  private receive(message: Response): void {
    const waiting = this.waiting.get(message.id)
    if (!waiting) return
    if (message.type === 'progress') {
      waiting.onProgress?.(message.progress)
      return
    }
    this.waiting.delete(message.id)
    waiting.cleanup()
    if (message.type === 'result') waiting.resolve(message.result)
    else waiting.reject(new EngineError(message.error.kind, message.error.message))
  }
}

/** Connects a client to an engine running in a Web Worker. */
export function workerTransport(worker: Worker): Transport {
  return {
    post: (message) => worker.postMessage(message),
    listen: (onMessage) => (worker.onmessage = (event: MessageEvent<Response>) => onMessage(event.data)),
  }
}
