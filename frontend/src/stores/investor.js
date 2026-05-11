import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useInvestorStore = defineStore('investor', () => {
  const capitalRange = ref('')
  const riskLevel    = ref(3)
  const period       = ref('')
  const completed    = ref(false)

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

  function saveProfile(data) {
    capitalRange.value = data.capitalRange
    riskLevel.value    = data.riskLevel
    period.value       = data.period
    completed.value    = true
  }

  function reset() {
    capitalRange.value = ''
    riskLevel.value    = 3
    period.value       = ''
    completed.value    = false
  }

  return {
    capitalRange, riskLevel, period, completed,
    profileLabel, profileEmoji, periodLabel,
    saveProfile, reset,
  }
})
