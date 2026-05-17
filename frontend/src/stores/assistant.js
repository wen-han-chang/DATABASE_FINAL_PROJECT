import { defineStore } from 'pinia'
import { ref } from 'vue'

const SESSION_KEY = 'invest_ai_assistant_messages'

const DEFAULT_MESSAGES = [
  {
    role: 'assistant',
    content: '你好，我可以協助你查詢台股、ETF、技術面與以資料為基礎的推薦。',
    evidence: [],
  },
]

function loadMessages() {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return Array.isArray(parsed) && parsed.length ? parsed : [...DEFAULT_MESSAGES]
  } catch {
    return [...DEFAULT_MESSAGES]
  }
}

export const useAssistantStore = defineStore('assistant', () => {
  const messages = ref(loadMessages())

  function persist() {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(messages.value))
  }

  function appendMessage(message) {
    messages.value.push(message)
    persist()
  }

  function reset() {
    messages.value = [...DEFAULT_MESSAGES]
    sessionStorage.removeItem(SESSION_KEY)
  }

  return {
    messages,
    appendMessage,
    reset,
  }
})
