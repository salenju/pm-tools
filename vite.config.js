import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

// GitHub Pages 项目站点需要 base = '/<仓库名>/'（用户/组织站点保持 '/'）。
// 通过 VITE_BASE 环境变量注入，默认 '/' 便于本地开发。
const base = process.env.VITE_BASE || '/'

export default defineConfig({
  base,
  plugins: [vue(), tailwindcss()],
  server: {
    port: 5173,
    host: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
})
