import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [vue(), VitePWA({
    registerType: 'autoUpdate',
    includeAssets: ['favicon.svg'],
    manifest: {
      name: 'Alyans sport', short_name: 'Alyans sport',
      description: 'Shtanga tosh qismlarini hisoblash dasturi',
      theme_color: '#14243a', background_color: '#f4f6fa',
      display: 'standalone', start_url: '/',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }
      ]
    },
    workbox: { navigateFallback: '/index.html' }
  })]
})
