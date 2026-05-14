import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const routes = [
  {
    path: '/login',
    component: () => import('@/views/LoginView.vue'),
    meta: { public: true },
  },
  {
    path: '/',
    component: () => import('@/views/HomeView.vue'),
  },
  {
    path: '/search',
    component: () => import('@/views/StockSearchView.vue'),
  },
  {
    path: '/trading',
    component: () => import('@/views/TradingView.vue'),
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach((to) => {
  const auth = useAuthStore()

  if (to.meta.public) return true
  if (!auth.isLoggedIn) return { path: '/login' }

  return true
})

export default router
