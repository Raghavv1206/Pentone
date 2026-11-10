// Native browser operations can settle after a timeout or cancellation. Attach
// both handlers immediately; callers remain responsible for releasing sessions.
export function waitForSetup<T>(operation: Promise<T>, signal?: AbortSignal, timeoutMs = 15000): Promise<T> {
  return new Promise((resolve, reject) => {
    const finish = (callback: (value: any) => void, value: any) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); callback(value) }
    const abort = () => finish(reject, new DOMException('Operation cancelled', 'AbortError'))
    const timer = setTimeout(() => finish(reject, new Error('This step is taking longer than expected. Please retry.')), timeoutMs)
    signal?.addEventListener('abort', abort, { once: true })
    operation.then(value => finish(resolve, value), error => finish(reject, error))
    if (signal?.aborted) abort()
  })
}
