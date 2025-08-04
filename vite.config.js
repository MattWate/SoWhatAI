import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  // Explicitly set the project root
  root: resolve(__dirname, 'SoWhatAI'), 
  plugins: [react()],
  build: {
    // The output directory for the build, relative to the root
    outDir: 'dist'
  }
})
