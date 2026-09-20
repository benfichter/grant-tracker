import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// API_PORT lets a second instance (e.g. a scratch-data test run) talk to a different API server.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': `http://localhost:${process.env.API_PORT ?? 5174}` } },
})
