import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // The API server (server/src/api/server.ts) runs separately on :4000.
      "/api": "http://localhost:4000",
    },
  },
})
