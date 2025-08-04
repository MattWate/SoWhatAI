import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
// This is the correct and final version.
// No 'root' property is needed.
export default defineConfig({
  plugins: [react()],
})
