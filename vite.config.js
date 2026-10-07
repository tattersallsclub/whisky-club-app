import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages serves a project site from /<repo-name>/, not from /.
// That path is only known at deploy time, so it is read from an
// environment variable instead of being hardcoded, which keeps local
// development (base "/") and the GitHub Pages build working from the
// same config file.
export default defineConfig({
  plugins: [react()],
  base: 'tattersalls-whisky-club-app/',
})
