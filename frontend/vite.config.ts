import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react-router-dom',
      'lucide-react',
      '@tanstack/react-query',
      '@tanstack/react-table',
      '@tanstack/react-virtual',
      'axios',
      'clsx',
      'tailwind-merge',
      'recharts',
      'sonner',
      'framer-motion',
      'cmdk',
      'date-fns',
      'react-hook-form',
      'react-markdown',
      'remark-gfm',
      'zod',
    ],
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
