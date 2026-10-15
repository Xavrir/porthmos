import { defineConfig, loadEnv, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'

// With no service running, answer the health probe with ok:false instead of a 502 so Replay starts without a console error.
function apiProxy(target: string): ProxyOptions {
  return {
    target,
    changeOrigin: true,
    configure: (proxy) => {
      proxy.on('error', (_err, req, res) => {
        const out = res as import('node:http').ServerResponse
        if (out.headersSent || typeof out.writeHead !== 'function') return
        const health = req.url?.startsWith('/api/health')
        out.writeHead(health ? 200 : 502, { 'Content-Type': 'application/json' })
        out.end(JSON.stringify(health ? { ok: false, reason: 'AEGIS service unreachable' } : { detail: 'AEGIS service unreachable' }))
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const target = env.AEGIS_API_TARGET || 'http://localhost:8787'
  return {
    plugins: [react()],
    server: {
      port: 5173,
      proxy: { '/api': apiProxy(target) },
    },
    preview: {
      proxy: { '/api': apiProxy(target) },
    },
    build: {
      target: 'es2022',
      chunkSizeWarningLimit: 900,
    },
  }
})
