/*
 * PRD FR-17 / 7.9.4：离线应用壳缓存。
 *
 * 采用零依赖的「运行时缓存」策略，不引入 vite-plugin-pwa：
 *   - 首次在线访问时把同源静态资源顺手缓存下来
 *   - 之后断网刷新页面仍能打开工具并渲染 IndexedDB 里的数据
 *
 * 关键安全约束：**只接管同源请求**。
 * api.github.com 的响应绝不能被 Service Worker 缓存，否则会读到过期的数据、
 * 破坏 7.9.3 的冲突检测。因此跨域请求一律直接放行。
 */

const CACHE_NAME = 'pm-tools-shell-v1'

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME)
      await cache.addAll(['./', './index.html']).catch(() => {})
      await self.skipWaiting()
    })(),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const { request } = event

  if (request.method !== 'GET') return

  const url = new URL(request.url)
  // 跨域（含 api.github.com）一律不接管
  if (url.origin !== self.location.origin) return

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME)
      try {
        const response = await fetch(request)
        if (response && response.status === 200 && response.type === 'basic') {
          cache.put(request, response.clone())
        }
        return response
      } catch (error) {
        const cached = await cache.match(request)
        if (cached) return cached

        // hash 路由下所有导航请求都指向同一份 index.html
        if (request.mode === 'navigate') {
          const fallback =
            (await cache.match('./index.html')) ||
            (await cache.match('./')) ||
            (await cache.match(self.registration.scope))
          if (fallback) return fallback
        }
        throw error
      }
    })(),
  )
})
