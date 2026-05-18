<template>
  <div class="p-6 max-w-5xl mx-auto space-y-6">
    <header>
      <h1 class="text-2xl font-bold text-brand-primary flex items-center gap-2">
        <Bot class="w-6 h-6 text-blue-500" />
        AI 助理
      </h1>
      <p class="text-sm text-brand-muted mt-1">
        選擇你現在需要的是自由提問，還是查看固定時段產生的股票建議。
      </p>
    </header>

    <div class="grid md:grid-cols-2 gap-5">
      <RouterLink
        to="/assistant/chat"
        class="group bg-white border border-slate-200 rounded-3xl p-6 shadow-sm hover:border-blue-300 hover:shadow-md transition-all"
      >
        <div class="w-12 h-12 rounded-2xl bg-blue-50 text-blue-600 flex items-center justify-center mb-5">
          <MessageSquare class="w-6 h-6" />
        </div>
        <h2 class="text-lg font-bold text-brand-primary">AI 聊天室</h2>
        <p class="text-sm text-brand-muted leading-7 mt-2">
          保留目前的自由問答模式，可詢問個股、ETF、技術面、成分股與資料型推薦。
        </p>
        <span class="inline-flex items-center gap-1 text-sm font-semibold text-blue-600 mt-5">
          進入聊天室
          <ArrowRight class="w-4 h-4 transition-transform group-hover:translate-x-1" />
        </span>
      </RouterLink>

      <RouterLink
        to="/assistant/advice"
        class="group bg-white border border-slate-200 rounded-3xl p-6 shadow-sm hover:border-emerald-300 hover:shadow-md transition-all"
      >
        <div class="w-12 h-12 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mb-5">
          <LineChart class="w-6 h-6" />
        </div>
        <h2 class="text-lg font-bold text-brand-primary">股票建議</h2>
        <p class="text-sm text-brand-muted leading-7 mt-2">
          進入頁面時即時分析下單練習中的股票，並產生最新股票建議。
        </p>
        <span class="inline-flex items-center gap-1 text-sm font-semibold text-emerald-600 mt-5">
          查看股票建議
          <ArrowRight class="w-4 h-4 transition-transform group-hover:translate-x-1" />
        </span>
      </RouterLink>
    </div>
  </div>
</template>

<script setup>
import { ArrowRight, Bot, LineChart, MessageSquare } from 'lucide-vue-next'
</script>
