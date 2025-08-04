import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  // Explicitly set the project root
  root: resolve(__dirname, 'SoWhatAI'),
  plugins: [react()],
  build: {
    outDir: 'dist'
  }
})
