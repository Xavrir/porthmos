import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './contract'
import { HttpApi } from './http'
import { SseParser } from './sse'

function feed(chunks: string[]) {
  const p = new SseParser()
  return [...chunks.flatMap((c) => p.push(c)), ...p.end()]
}

describe('SseParser', () => {
  it('reassembles events split anywhere across chunks', () => {
    const text = 'event: delta\ndata: {"text":"Hello"}\n\nevent: done\ndata: {"reply":"Hello"}\n\n'
    const whole = feed([text])
    expect(whole).toEqual([{ event: 'delta', data: '{"text":"Hello"}' }, { event: 'done', data: '{"reply":"Hello"}' }])
    for (let i = 1; i < text.length; i++) expect(feed([text.slice(0, i), text.slice(i)])).toEqual(whole)
    expect(feed(text.split(''))).toEqual(whole)
  })

  it('handles CRLF, a CRLF split across chunks and bare CR', () => {
    expect(feed(['event: a\r', '\ndata: 1\r\n\r', '\n'])).toEqual([{ event: 'a', data: '1' }])
    expect(feed(['event: a\rdata: 1\r\r'])).toEqual([{ event: 'a', data: '1' }])
  })

  it('joins multi-line data, skips comments and empty events, defaults the name', () => {
    expect(feed([': keepalive\n\n', 'event: x\n\n', 'data: one\ndata:two\ndata:  three\n\n'])).toEqual([{ event: 'message', data: 'one\ntwo\n three' }])
  })

  it('drops an unterminated event at the end of the stream', () => {
    expect(feed(['event: done\ndata: {"reply":"cut'])).toEqual([])
  })
})

function sseResponse(chunks: string[], status = 200) {
  const enc = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      for (const x of chunks) c.enqueue(enc.encode(x))
      c.close()
    },
  })
  return new Response(body, { status, headers: { 'content-type': 'text/event-stream' } })
}

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } })

const DONE = { reply: 'All quiet today.', requestId: 'req_1', state: 'EXPLAINED', replyMode: 'llm' }

describe('HttpApi.chatStream', () => {
  afterEach(() => vi.unstubAllGlobals())

  function api(fetchImpl: (url: string, init?: RequestInit) => Promise<Response>) {
    const f = vi.fn(fetchImpl)
    vi.stubGlobal('fetch', f)
    const a = new HttpApi('http://svc')
    a.setSession('tok')
    return { a, f }
  }

  it('reports stages, deltas and replace, then returns the done body', async () => {
    const { a, f } = api(async () => sseResponse([
      'event: status\ndata: {"stage":"thinking"}\n\nevent: status\ndata: {"stage":"wri',
      'ting"}\n\nevent: delta\ndata: {"text":"All"}\n\n: keepalive\n\nevent: delta\ndata: {"text":" quiet"}\r\n\r\n',
      'event: replace\ndata: {"text":"All quiet"}\n\n',
      `event: done\ndata: ${JSON.stringify(DONE)}\n\n`,
    ]))
    const seen: string[] = []
    const res = await a.chatStream('hi', {
      onStatus: (s) => seen.push(`status:${s}`),
      onDelta: (t) => seen.push(`delta:${t}`),
      onReplace: (t) => seen.push(`replace:${t}`),
    })
    expect(res).toEqual(DONE)
    expect(seen).toEqual(['status:thinking', 'status:writing', 'delta:All', 'delta: quiet', 'replace:All quiet'])
    expect(f).toHaveBeenCalledTimes(1)
    const [url, init] = f.mock.calls[0]
    expect(url).toBe('http://svc/api/agent/chat/stream')
    expect((init?.headers as Record<string, string>)['X-Aegis-Session']).toBe('tok')
  })

  it.each([
    ['a 404', () => Promise.resolve(json({ detail: 'Not Found' }, 404))],
    ['a network error', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['an HTML page with 200', () => Promise.resolve(new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }))],
  ])('falls back to /api/agent/chat on %s', async (_, first) => {
    const { a, f } = api(async (url) => (url.endsWith('/stream') ? first() : json(DONE)))
    await expect(a.chatStream('hi', {})).resolves.toEqual(DONE)
    expect(f.mock.calls.map((c) => c[0])).toEqual(['http://svc/api/agent/chat/stream', 'http://svc/api/agent/chat'])
  })

  it('turns an error event into an ApiError without a second request', async () => {
    const { a, f } = api(async () => sseResponse(['event: error\ndata: {"status":429,"code":"RateLimited","detail":"slow down"}\n\n']))
    const err = await a.chatStream('hi', {}).catch((e) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect([err.status, err.code, err.message]).toEqual([429, 'RateLimited', 'slow down'])
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('does not resend when an accepted stream ends without done', async () => {
    const { a, f } = api(async () => sseResponse(['event: status\ndata: {"stage":"thinking"}\n\n']))
    await expect(a.chatStream('hi', {})).rejects.toThrow(/ended early/)
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('stops on abort without falling back', async () => {
    const ctrl = new AbortController()
    const { a, f } = api((_, init) => new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))))
    const p = a.chatStream('hi', {}, ctrl.signal)
    ctrl.abort()
    await expect(p).rejects.toMatchObject({ name: 'AbortError' })
    expect(f).toHaveBeenCalledTimes(1)
  })
})
