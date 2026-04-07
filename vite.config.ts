import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'
import tsconfigPaths from 'vite-tsconfig-paths'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const config = defineConfig({
  server: {
    fs: {
      allow: ['..', '../../../..'],
    },
    proxy: {
      '/api/voices': {
        target: 'https://users.rime.ai',
        changeOrigin: true,
        rewrite: () => '/data/voices/voice_details.json',
      },
      '/api/oov': {
        target: 'https://users.rime.ai',
        changeOrigin: true,
        rewrite: () => '/oov',
      },
    },
  },
  plugins: [
    devtools(),
    tsconfigPaths({ projects: ['./tsconfig.json'] }),
    tailwindcss(),
    tanstackStart({
      spa: {
        maskPath: '/',
        prerender: {
          outputPath: '/index',
        },
      },
    }),
    viteReact(),
  ],
})

export default config
