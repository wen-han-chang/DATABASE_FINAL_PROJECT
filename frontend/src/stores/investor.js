import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { saveProfileApi, getProfileApi } from '@/services/api'

// 本地快取（key 與其他 store 一致命名），讓路由守衛在重新整理後仍可同步判斷
// completed。真正資料來源是後端 investor_profiles 表，loadProfile() 會覆蓋。
const CACHE_KEY = 'invest_ai_investor'

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export const useInvestorStore = defineStore('investor', () => {
  const cached = loadCache()

  const capitalRange = ref(cached?.capitalRange ?? '')
  const riskLevel    = ref(cached?.riskLevel ?? 3)
  const period       = ref(cached?.period ?? '')
  const completed    = ref(cached?.completed ?? false)

  // ── 以下 computed 與舊版完全相同，元件不用改 ──
  const profileLabel = computed(() => {
    if (!completed.value) return ''
    if (riskLevel.value <= 2) return '保守防禦型'
    if (riskLevel.value === 3) return '穩健成長型'
    if (riskLevel.value === 4) return '積極成長型'
    return '高風險追求型'
  })

  const profileEmoji = computed(() => {
    if (!completed.value) return ''
    if (riskLevel.value <= 2) return '🛡️'
    if (riskLevel.value === 3) return '🌱'
    if (riskLevel.value === 4) return '🚀'
    return '⚡'
  })

  const periodLabel = computed(() => ({
    short: '短線 < 3個月',
    mid:   '中線 3–12個月',
    long:  '長線 > 1年',
  })[period.value] ?? '')

  function persist() {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
      capitalRange: capitalRange.value,
      riskLevel: riskLevel.value,
      period: period.value,
      completed: completed.value,
    }))
  }

  /**
   * 儲存問卷結果 → 寫進後端 investor_profiles 表。
   * 簽名仍是 saveProfile(data)，但改為 async（Onboarding.vue 會 await）。
   * 先樂觀更新本地（讓路由守衛立刻放行），再送 API；失敗則回滾並丟錯。
   */
  async function saveProfile(data) {
    const prev = {
      capitalRange: capitalRange.value,
      riskLevel: riskLevel.value,
      period: period.value,
      completed: completed.value,
    }

    capitalRange.value = data.capitalRange
    riskLevel.value    = data.riskLevel
    period.value       = data.period
    completed.value    = true
    persist()

    try {
      await saveProfileApi({
        capitalRange: data.capitalRange,
        riskLevel: data.riskLevel,
        period: data.period,
      })
    } catch (e) {
      // 後端存失敗就回滾本地狀態，避免「以為存好其實沒存」
      capitalRange.value = prev.capitalRange
      riskLevel.value    = prev.riskLevel
      period.value       = prev.period
      completed.value    = prev.completed
      persist()
      throw e
    }
  }

  /**
   * 從後端載入既有問卷結果（登入後 / 重新整理後呼叫）。
   * 有資料 → 填回並標記 completed；沒資料維持未完成。
   */
  async function loadProfile() {
    try {
      const { profile } = await getProfileApi()
      if (profile) {
        capitalRange.value = profile.capitalRange
        riskLevel.value    = Number(profile.riskLevel)
        period.value       = profile.period
        completed.value    = true
      } else {
        completed.value = false
      }
      persist()
    } catch {
      // 載入失敗（例如後端沒開）不阻斷流程，維持目前快取狀態
    }
  }

  function reset() {
    capitalRange.value = ''
    riskLevel.value    = 3
    period.value       = ''
    completed.value    = false
    localStorage.removeItem(CACHE_KEY)
  }

  return {
    capitalRange, riskLevel, period, completed,
    profileLabel, profileEmoji, periodLabel,
    saveProfile, loadProfile, reset,
  }
})
