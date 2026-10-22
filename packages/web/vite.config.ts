import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const API_TARGET = process.env.TURNFLARE_API_ORIGIN ?? 'http://127.0.0.1:8787'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // 显式绑 127.0.0.1：默认的 localhost 在本机解析到 IPv6 的 ::1，
    // 于是 127.0.0.1:5173 永远连不上——Playwright 的 webServer 探活会一直超时。
    host: '127.0.0.1',
    strictPort: false,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        // Vite 8 起打包器换成 rolldown，其 manualChunks 只接受函数形式
        // （对象形式会直接抛 "manualChunks is not a function"）。
        // 分成 react 与 charts 两块：图表库体积大且不常变，单独切出来利于缓存。
        manualChunks: (id: string): string | undefined => {
          if (id.includes('node_modules/recharts')) {
            return 'charts'
          }
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) {
            return 'react'
          }
          return undefined
        },
      },
    },
  },
})
