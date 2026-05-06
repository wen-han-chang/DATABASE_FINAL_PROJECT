import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useInvestorStore } from '@/stores/investor'

const routes = [
  {
    path: '/login',
    component: () => import('@/views/LoginView.vue'),
    meta: { public: true },
  },
  {
    path: '/onboarding',
    component: () => import('@/views/OnboardingView.vue'),
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
  const auth     = useAuthStore()
  const investor = useInvestorStore()

  // Public routes (login page) — always allow
  if (to.meta.public) return true

  // Not logged in → go to login
  if (!auth.isLoggedIn) return { path: '/login' }

  // Logged in but onboarding not done → go to onboarding
  if (!investor.completed && to.path !== '/onboarding') return { path: '/onboarding' }

  // Onboarding done, prevent going back to /onboarding
  if (investor.completed && to.path === '/onboarding') return { path: '/' }

  return true
})

export default router
