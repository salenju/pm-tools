import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './style.css'

createApp(App).use(createPinia()).use(router).mount('#app')

/*
 * PRD FR-17：注册离线应用壳。
 * 只在生产环境注册 —— 开发环境让 Service Worker 与 Vite HMR 抢请求会互相干扰。
 */
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL })
      .catch((error) => {
        console.warn('[pm-tools] Service Worker 注册失败，离线能力不可用：', error)
      })
  })
}
