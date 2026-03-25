// This file is now located at: SoWhatAI/vite.config.js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_COMMIT_REF': JSON.stringify(
      process.env.COMMIT_REF || process.env.VITE_COMMIT_REF || ''
    ),
  },
})
