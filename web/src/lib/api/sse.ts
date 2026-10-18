export type SseMessage = { event: string; data: string }

// Incremental text/event-stream parser after the WHATWG rules: lines end in CRLF, LF or CR, a blank line ends an
// event, data lines join with a newline, and lines starting with a colon are comments.
export class SseParser {
  private buffer = ''
  private event = ''
  private data: string[] = []

  push(chunk: string): SseMessage[] {
    this.buffer += chunk
    const out: SseMessage[] = []
    for (;;) {
      const m = /\r\n|\n|\r/.exec(this.buffer)
      if (!m) break
      // A CR at the very end may be the first half of a CRLF that the next chunk completes.
      if (m[0] === '\r' && m.index === this.buffer.length - 1) break
      const line = this.buffer.slice(0, m.index)
      this.buffer = this.buffer.slice(m.index + m[0].length)
      this.line(line, out)
    }
    return out
  }

  // At end of stream an event without its closing blank line is dropped, as EventSource does.
  end(): SseMessage[] {
    const out: SseMessage[] = []
    if (this.buffer.endsWith('\r')) this.line(this.buffer.slice(0, -1), out)
    this.buffer = ''
    this.event = ''
    this.data = []
    return out
  }

  private line(line: string, out: SseMessage[]) {
    if (line === '') {
      if (this.data.length) out.push({ event: this.event || 'message', data: this.data.join('\n') })
      this.event = ''
      this.data = []
      return
    }
    if (line.startsWith(':')) return
    const colon = line.indexOf(':')
    const field = colon < 0 ? line : line.slice(0, colon)
    let value = colon < 0 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') this.event = value
    else if (field === 'data') this.data.push(value)
  }
}
