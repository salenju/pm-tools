import { createRouter, createWebHashHistory } from 'vue-router'
import { useSessionStore } from '../stores/session'

/*
 * 使用 hash 模式（PRD 7.4）：GitHub Pages 无服务端重写能力，
 * history 模式下刷新子路由会 404。
 */
const routes = [
  { path: '/', name: 'kanban', component: () => import('../views/KanbanView.vue') },
  { path: '/projects', name: 'projects', component: () => import('../views/ProjectListView.vue') },
  {
    path: '/projects/:id',
    name: 'project-detail',
    component: () => import('../views/ProjectDetailView.vue'),
    props: true,
  },
  { path: '/customers', name: 'customers', component: () => import('../views/CustomerListView.vue') },
  {
    path: '/customers/:id',
    name: 'customer-detail',
    component: () => import('../views/CustomerDetailView.vue'),
    props: true,
  },
  { path: '/todos', name: 'todos', component: () => import('../views/TodoView.vue') },
  { path: '/templates', name: 'templates', component: () => import('../views/TemplateView.vue') },
  { path: '/setup', name: 'setup', component: () => import('../views/SetupView.vue') },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 }),
})

router.beforeEach((to) => {
  const session = useSessionStore()
  if (!session.isReady && to.name !== 'setup') {
    return { name: 'setup', query: { redirect: to.fullPath } }
  }
  if (session.isReady && to.name === 'setup' && to.query.force !== '1') {
    return { name: 'kanban' }
  }
  return true
})

export default router
