import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { loginApi, registerApi, setToken, clearToken, getToken } from '@/services/api'

// 使用者基本資料快取在 localStorage，讓重新整理後路由守衛仍能同步判斷登入狀態
// （真正的資料來源是後端 ncu_db，這裡只是 UX 用的快取）
const USER_KEY = 'invest_ai_user'

function loadCachedUser() {
  try {
    const raw = localStorage.getItem(USER_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export const useAuthStore = defineStore('auth', () => {
  const user    = ref(loadCachedUser())   // { id, email, name, avatar }
  const error   = ref('')
  const loading = ref(false)

  // 同時要有使用者資料與 token 才算登入
  const isLoggedIn = computed(() => user.value !== null && !!getToken())

  function persist(u, token) {
    user.value = u
    localStorage.setItem(USER_KEY, JSON.stringify(u))
    setToken(token)
  }

  /**
   * 登入：打後端 /api/auth/login。
   * 簽名與舊版一致 login(email, password)，所以 Login.vue 不用大改。
   * 成功 → 存 user + token；失敗 → 設 error 並丟錯（讓 UI 顯示）。
   */
  async function login(email, password) {
    loading.value = true
    error.value = ''
    try {
      const { user: u, token } = await loginApi({ email: email.trim().toLowerCase(), password })
      persist(u, token)
      return u
    } catch (e) {
      error.value = e.message || '登入失敗，請重試'
      throw e
    } finally {
      loading.value = false
    }
  }

  /**
   * 註冊：打後端 /api/auth/register，成功後直接視為登入。
   * （目前 UI 沒有註冊頁，先保留此方法供未來擴充或測試用。）
   */
  async function register(payload) {
    loading.value = true
    error.value = ''
    try {
      const { user: u, token } = await registerApi(payload)
      persist(u, token)
      return u
    } catch (e) {
      error.value = e.message || '註冊失敗'
      throw e
    } finally {
      loading.value = false
    }
  }

  function logout() {
    user.value = null
    error.value = ''
    clearToken()
    // 連同其他 store 的本地快取一起清掉，避免顯示上一個帳號的殘留資料
    localStorage.removeItem(USER_KEY)
    localStorage.removeItem('invest_ai_investor')
    localStorage.removeItem('invest_ai_portfolio')
  }

  return { user, error, loading, isLoggedIn, login, register, logout }
})
