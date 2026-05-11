import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

// Mock user database
const MOCK_USERS = [
  { email: 'demo@invest.ai', password: 'demo123', name: '示範用戶', avatar: '🧑‍💼' },
  { email: 'user@example.com', password: 'password', name: '測試帳號', avatar: '👤' },
]

export const useAuthStore = defineStore('auth', () => {
  const user      = ref(null)   // { email, name, avatar }
  const error     = ref('')
  const loading   = ref(false)

  const isLoggedIn = computed(() => user.value !== null)

  function login(email, password) {
    loading.value = true
    error.value   = ''

    return new Promise((resolve, reject) => {
      setTimeout(() => {
        const found = MOCK_USERS.find(
          u => u.email === email.trim().toLowerCase() && u.password === password
        )
        loading.value = false
        if (found) {
          user.value = { email: found.email, name: found.name, avatar: found.avatar }
          resolve(found)
        } else {
          error.value = '電子郵件或密碼錯誤，請重試'
          reject(new Error(error.value))
        }
      }, 800)
    })
  }

  function logout() {
    user.value  = null
    error.value = ''
  }

  return { user, error, loading, isLoggedIn, login, logout }
})
