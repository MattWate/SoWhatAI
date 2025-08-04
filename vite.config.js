import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  // Set the project root to the current directory
  root: __dirname,
  plugins: [react()],
  build: {
    outDir: 'dist'
  }
})
