<template>
  <div class="p-6 max-w-screen-xl mx-auto space-y-6">

    <!-- Page header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-brand-primary flex items-center gap-2">
          <Wallet class="w-6 h-6 text-blue-500" />
          模擬下單系統
        </h1>
        <p class="text-brand-muted text-sm mt-1">以模擬資金體驗台股買賣，訓練投資直覺</p>
      </div>
      <button v-if="portfolio.isReady" @click="confirmReset = true"
        class="flex items-center gap-1.5 text-xs text-slate-400 hover:text-red-500 transition-colors px-3 py-2 rounded-lg hover:bg-red-50">
        <RotateCcw class="w-3.5 h-3.5" />
        重置帳戶
      </button>
    </div>

    <!-- ══ SETUP CARD (first time) ══════════════════════════ -->
    <Transition name="fade" mode="out-in">
      <div v-if="!portfolio.isReady" key="setup"
        class="max-w-lg mx-auto bg-white rounded-3xl shadow-xl p-8 border border-slate-100">
        <div class="text-center mb-7">
          <div class="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center mx-auto mb-4">
            <PiggyBank class="w-8 h-8 text-blue-500" />
          </div>
          <h2 class="text-xl font-bold text-brand-primary">設定初始資產</h2>
          <p class="text-brand-muted text-sm mt-2">輸入您的模擬資金總額，開始體驗台股投資</p>
        </div>

        <!-- Quick presets -->
        <p class="text-xs font-semibold text-brand-muted mb-2">快速選擇</p>
        <div class="grid grid-cols-4 gap-2 mb-5">
          <button v-for="preset in capitalPresets" :key="preset.value"
            @click="setupAmount = preset.value"
            class="py-2 rounded-xl border-2 text-sm font-semibold transition-all"
            :class="setupAmount === preset.value
              ? 'border-blue-500 bg-blue-50 text-blue-700'
              : 'border-slate-200 text-brand-muted hover:border-blue-300'">
            {{ preset.label }}
          </button>
        </div>

        <!-- Custom input -->
        <div class="mb-6">
          <label class="block text-xs font-semibold text-brand-primary mb-1.5">自訂金額（元）</label>
          <div class="relative">
            <span class="absolute left-3.5 top-1/2 -translate-y-1/2 text-brand-muted text-sm font-medium">$</span>
            <input v-model.number="setupAmount" type="number" min="10000" step="10000"
              placeholder="例如：1000000"
              class="w-full pl-8 pr-4 py-3 rounded-xl border border-slate-200 bg-slate-50
                     text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20" />
          </div>
          <p v-if="setupAmount > 0" class="text-xs text-blue-500 mt-1.5">
            = {{ setupAmount.toLocaleString('zh-TW') }} 元
          </p>
        </div>

        <button @click="doSetup"
          :disabled="!setupAmount || setupAmount < 10000"
          class="w-full py-3.5 rounded-2xl font-semibold text-white transition-all
                 disabled:opacity-40 disabled:cursor-not-allowed"
          :class="setupAmount >= 10000 ? 'bg-brand-primary hover:bg-slate-800 active:scale-[0.98]' : 'bg-slate-300'">
          開始模擬交易
        </button>
      </div>

      <!-- ══ MAIN TRADING UI ════════════════════════════════ -->
      <div v-else key="trading" class="space-y-5">

        <!-- Asset summary bar -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div class="bg-brand-primary rounded-2xl p-4 text-white col-span-2 sm:col-span-1">
            <p class="text-xs text-slate-400 mb-1">總資產</p>
            <p class="text-xl font-bold font-mono">{{ fmt(portfolio.totalAssets) }}</p>
            <p class="text-xs mt-1" :class="portfolio.totalPnL >= 0 ? 'text-green-400' : 'text-red-400'">
              {{ portfolio.totalPnL >= 0 ? '+' : '' }}{{ fmt(portfolio.totalPnL) }}
              （{{ portfolio.totalPnLPct >= 0 ? '+' : '' }}{{ portfolio.totalPnLPct.toFixed(2) }}%）
            </p>
          </div>
          <div v-for="stat in summaryStats" :key="stat.label"
            class="bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
            <p class="text-xs text-brand-muted mb-1">{{ stat.label }}</p>
            <p class="font-bold font-mono text-brand-primary">{{ stat.value }}</p>
            <p v-if="stat.sub" class="text-xs text-brand-muted mt-0.5">{{ stat.sub }}</p>
          </div>
        </div>

        <!-- Fee / Tax summary bar -->
        <div class="grid grid-cols-3 gap-3">
          <div v-for="stat in feeStats" :key="stat.label"
            class="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center gap-3">
            <div class="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
              :class="stat.iconBg">
              <component :is="stat.icon" class="w-4 h-4" :class="stat.iconColor" />
            </div>
            <div>
              <p class="text-xs text-amber-700 mb-0.5">{{ stat.label }}</p>
              <p class="font-bold font-mono text-amber-900">{{ fmt(stat.value) }} 元</p>
              <p class="text-[11px] text-amber-600 mt-0.5">{{ stat.note }}</p>
            </div>
          </div>
        </div>

        <!-- Main grid -->
        <div class="grid grid-cols-1 xl:grid-cols-12 gap-5">

          <!-- ── Left: Order panel ─────────────────────────── -->
          <div class="xl:col-span-4 space-y-4">

            <!-- Stock search -->
            <div class="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 space-y-3">
              <h3 class="text-sm font-bold text-brand-primary flex items-center gap-2">
                <Search class="w-4 h-4 text-blue-500" />選股
              </h3>

              <div class="relative">
                <div class="flex items-center gap-2 border-2 rounded-xl px-3 py-2.5 transition-colors"
                  :class="searchFocused ? 'border-blue-500' : 'border-slate-200'">
                  <Search class="w-4 h-4 text-slate-400 flex-shrink-0" />
                  <input ref="searchInput" v-model="query" type="text"
                    placeholder="代碼或名稱…"
                    class="flex-1 outline-none text-sm text-brand-primary placeholder:text-slate-400 bg-transparent"
                    @focus="searchFocused = true"
                    @blur="onSearchBlur"
                    @keydown.down.prevent="moveHL(1)"
                    @keydown.up.prevent="moveHL(-1)"
                    @keydown.enter="pickHL"
                    @keydown.escape="showDrop = false"
                    autocomplete="off" />
                  <button v-if="query" @click="clearSearch" class="text-slate-400 hover:text-slate-600">
                    <X class="w-3.5 h-3.5" />
                  </button>
                </div>

                <!-- Dropdown -->
                <Transition name="dropdown">
                  <div v-if="showDrop && searchResults.length"
                    class="absolute top-full left-0 right-0 mt-1.5 bg-white border border-slate-200
                           rounded-xl shadow-xl z-20 overflow-hidden">
                    <button v-for="(s, i) in searchResults" :key="s.code"
                      @mousedown.prevent="pickStock(s)"
                      @mouseover="hlIdx = i"
                      class="w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors border-b border-slate-50 last:border-0"
                      :class="hlIdx === i ? 'bg-blue-50' : 'hover:bg-slate-50'">
                      <span class="w-14 text-center text-xs font-bold py-0.5 rounded-md flex-shrink-0"
                        :class="hlIdx === i ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-600'">
                        {{ s.code }}
                      </span>
                      <span class="text-sm font-medium text-brand-primary flex-1 truncate">{{ s.name }}</span>
                      <span class="text-xs text-brand-muted flex-shrink-0">{{ s.sector }}</span>
                    </button>
                  </div>
                </Transition>
              </div>

              <!-- Selected stock info -->
              <Transition name="fade">
                <div v-if="activeStock" class="pt-1 space-y-3">
                  <div class="flex items-center justify-between">
                    <div>
                      <span class="font-bold text-brand-primary">{{ activeStock.name }}</span>
                      <span class="text-xs text-brand-muted ml-2">{{ activeStock.code }}</span>
                    </div>
                    <div class="text-right">
                      <p class="font-mono font-bold text-lg"
                        :class="priceChange >= 0 ? 'text-stock-up' : 'text-stock-down'">
                        {{ mockPrice.toFixed(2) }}
                      </p>
                      <p class="text-xs" :class="priceChange >= 0 ? 'text-stock-up' : 'text-stock-down'">
                        {{ priceChange >= 0 ? '+' : '' }}{{ priceChange.toFixed(2) }}
                        ({{ priceChangePct >= 0 ? '+' : '' }}{{ priceChangePct.toFixed(2) }}%)
                      </p>
                    </div>
                  </div>

                  <!-- Holding badge -->
                  <div v-if="currentHolding" class="bg-blue-50 rounded-xl px-3 py-2 flex items-center justify-between">
                    <span class="text-xs text-blue-600">目前持有</span>
                    <span class="text-xs font-bold text-blue-700">
                      {{ formatSharesDisplay(currentHolding.shares) }} · 均成本 {{ currentHolding.avgCost.toFixed(2) }}
                    </span>
                  </div>
                </div>
              </Transition>
            </div>

            <!-- Order form -->
            <Transition name="fade">
              <div v-if="activeStock"
                class="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 space-y-4">
                <h3 class="text-sm font-bold text-brand-primary flex items-center gap-2">
                  <ShoppingCart class="w-4 h-4 text-blue-500" />下單
                </h3>

                <!-- Buy / Sell toggle -->
                <div class="flex rounded-xl border border-slate-200 overflow-hidden">
                  <button @click="orderType = 'buy'" class="flex-1 py-2.5 text-sm font-bold transition-all"
                    :class="orderType === 'buy' ? 'bg-stock-up text-white' : 'text-slate-400 hover:bg-slate-50'">
                    買入
                  </button>
                  <button @click="orderType = 'sell'" class="flex-1 py-2.5 text-sm font-bold transition-all"
                    :class="orderType === 'sell' ? 'bg-stock-down text-white' : 'text-slate-400 hover:bg-slate-50'">
                    賣出
                  </button>
                </div>

                <!-- 整張 / 零股 mode toggle -->
                <div class="flex items-center justify-between">
                  <span class="text-xs text-brand-muted font-medium">交易模式</span>
                  <div class="flex rounded-lg border border-slate-200 overflow-hidden text-xs">
                    <button @click="tradeMode = 'lot'"
                      class="px-4 py-1.5 font-bold transition-all"
                      :class="tradeMode === 'lot' ? 'bg-blue-500 text-white' : 'text-slate-500 hover:bg-slate-50'">
                      整張
                    </button>
                    <button @click="tradeMode = 'share'"
                      class="px-4 py-1.5 font-bold transition-all"
                      :class="tradeMode === 'share' ? 'bg-blue-500 text-white' : 'text-slate-500 hover:bg-slate-50'">
                      零股
                    </button>
                  </div>
                </div>

                <!-- Quantity -->
                <div>
                  <label class="text-xs font-semibold text-brand-primary block mb-1.5">
                    {{ tradeMode === 'lot' ? '數量（張）' : '股數（零股）' }}
                  </label>
                  <div class="flex items-center gap-2">
                    <button @click="qty = Math.max(1, qty - 1)"
                      class="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center
                             hover:bg-slate-200 transition-colors font-bold text-brand-primary text-lg leading-none">−</button>
                    <input v-model.number="qty" type="number" min="1" step="1"
                      class="flex-1 text-center py-2 rounded-lg border border-slate-200 text-sm font-bold
                             outline-none focus:border-blue-500" />
                    <button @click="qty++"
                      class="w-9 h-9 rounded-lg bg-slate-100 flex items-center justify-center
                             hover:bg-slate-200 transition-colors font-bold text-brand-primary text-lg leading-none">+</button>
                  </div>
                  <p v-if="tradeMode === 'lot'" class="text-[11px] text-brand-muted mt-1">
                    1 張 = 1,000 股，合計 {{ actualShares.toLocaleString('zh-TW') }} 股
                  </p>
                  <p v-else class="text-[11px] text-brand-muted mt-1">
                    零股最少 1 股，以市場現價成交
                  </p>
                </div>

                <!-- Price (read-only market price) -->
                <div>
                  <label class="text-xs font-semibold text-brand-primary block mb-1.5">市價（元/股）</label>
                  <div class="py-2.5 px-3.5 rounded-lg bg-slate-50 border border-slate-200 text-sm font-mono font-bold text-brand-primary">
                    {{ mockPrice.toFixed(2) }}
                  </div>
                </div>

                <!-- Fee breakdown -->
                <div class="bg-slate-50 rounded-xl p-3 space-y-1.5 text-xs">
                  <div class="flex justify-between text-brand-muted">
                    <span v-if="tradeMode === 'lot'">面額 ({{ qty }}張 × 1000股 × {{ mockPrice.toFixed(2) }}元)</span>
                    <span v-else>面額 ({{ qty }}股 × {{ mockPrice.toFixed(2) }}元)</span>
                    <span class="font-mono">{{ fmt(faceAmount) }}</span>
                  </div>
                  <div class="flex justify-between text-brand-muted">
                    <span>手續費 (0.1425%)</span>
                    <span class="font-mono">−{{ fmt(fee) }}</span>
                  </div>
                  <div v-if="orderType === 'sell'" class="flex justify-between text-brand-muted">
                    <span>證交稅 ({{ isETF ? '0.1%' : '0.3%' }})</span>
                    <span class="font-mono">−{{ fmt(tax) }}</span>
                  </div>
                  <div class="flex justify-between font-bold text-brand-primary pt-1 border-t border-slate-200">
                    <span>{{ orderType === 'buy' ? '合計支出' : '實際到帳' }}</span>
                    <span class="font-mono text-sm">{{ fmt(totalAmount) }} 元</span>
                  </div>
                </div>

                <!-- Submit -->
                <button @click="placeOrder"
                  :disabled="!canOrder"
                  class="w-full py-3.5 rounded-2xl font-bold text-white text-sm transition-all active:scale-[0.98]
                         disabled:opacity-40 disabled:cursor-not-allowed"
                  :class="orderType === 'buy'
                    ? 'bg-stock-up hover:bg-red-600'
                    : 'bg-stock-down hover:bg-green-600'">
                  確認{{ orderType === 'buy' ? '買入' : '賣出' }}
                  {{ tradeMode === 'lot' ? `${qty} 張` : `${qty} 股` }}
                </button>

                <!-- Validation hint -->
                <p v-if="validationMsg" class="text-xs text-red-500 text-center -mt-1">{{ validationMsg }}</p>
              </div>
            </Transition>
          </div>

          <!-- ── Right: Holdings + History ─────────────────── -->
          <div class="xl:col-span-8 space-y-4">

            <!-- Tab bar -->
            <div class="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit">
              <button v-for="tab in ['持股明細', '交易紀錄']" :key="tab"
                @click="activeTab = tab"
                class="px-4 py-1.5 rounded-lg text-sm font-semibold transition-all"
                :class="activeTab === tab
                  ? 'bg-white text-brand-primary shadow-sm'
                  : 'text-brand-muted hover:text-brand-primary'">
                {{ tab }}
                <span v-if="tab === '持股明細' && portfolio.holdings.length"
                  class="ml-1.5 text-xs bg-blue-500 text-white px-1.5 py-0.5 rounded-full">
                  {{ portfolio.holdings.length }}
                </span>
              </button>
            </div>

            <!-- Holdings table -->
            <Transition name="fade" mode="out-in">
              <div v-if="activeTab === '持股明細'" key="holdings">
                <div v-if="portfolio.holdingsWithValue.length === 0"
                  class="bg-white rounded-2xl border border-slate-100 shadow-sm p-12 text-center">
                  <Inbox class="w-10 h-10 mx-auto text-slate-300 mb-3" />
                  <p class="text-brand-muted text-sm">尚無持股，從左側搜尋股票並下單</p>
                </div>
                <div v-else class="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                  <table class="w-full text-sm">
                    <thead>
                      <tr class="border-b border-slate-100 bg-slate-50">
                        <th v-for="col in holdingCols" :key="col"
                          class="px-4 py-3 text-left text-xs font-semibold text-brand-muted">
                          {{ col }}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="h in portfolio.holdingsWithValue" :key="h.code"
                        class="border-b border-slate-50 last:border-0 hover:bg-slate-50 transition-colors cursor-pointer"
                        @click="quickSelect(h.code)">
                        <td class="px-4 py-3.5">
                          <p class="font-semibold text-brand-primary">{{ h.name }}</p>
                          <p class="text-xs text-brand-muted">{{ h.code }}</p>
                        </td>
                        <td class="px-4 py-3.5 font-mono text-center">{{ formatSharesDisplay(h.shares) }}</td>
                        <td class="px-4 py-3.5 font-mono text-right">{{ h.avgCost.toFixed(2) }}</td>
                        <td class="px-4 py-3.5 font-mono text-right">{{ h.price.toFixed(2) }}</td>
                        <td class="px-4 py-3.5 font-mono text-right">{{ fmt(h.marketVal) }}</td>
                        <td class="px-4 py-3.5 text-right">
                          <p class="font-mono font-semibold"
                            :class="h.pnl >= 0 ? 'text-stock-up' : 'text-stock-down'">
                            {{ h.pnl >= 0 ? '+' : '' }}{{ fmt(h.pnl) }}
                          </p>
                          <p class="text-xs"
                            :class="h.pnl >= 0 ? 'text-stock-up' : 'text-stock-down'">
                            {{ h.pnlPct >= 0 ? '+' : '' }}{{ h.pnlPct.toFixed(2) }}%
                          </p>
                        </td>
                      </tr>
                    </tbody>
                    <!-- Footer total -->
                    <tfoot>
                      <tr class="bg-slate-50 border-t-2 border-slate-200">
                        <td class="px-4 py-3 font-semibold text-brand-primary text-xs" colspan="4">合計</td>
                        <td class="px-4 py-3 font-mono font-bold text-brand-primary text-right">
                          {{ fmt(portfolio.totalHoldingsValue) }}
                        </td>
                        <td class="px-4 py-3 text-right">
                          <p class="font-mono font-bold"
                            :class="portfolio.totalPnL >= 0 ? 'text-stock-up' : 'text-stock-down'">
                            {{ portfolio.totalPnL >= 0 ? '+' : '' }}{{ fmt(portfolio.totalPnL) }}
                          </p>
                          <p class="text-xs"
                            :class="portfolio.totalPnL >= 0 ? 'text-stock-up' : 'text-stock-down'">
                            {{ portfolio.totalPnLPct >= 0 ? '+' : '' }}{{ portfolio.totalPnLPct.toFixed(2) }}%
                          </p>
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              <!-- Order history -->
              <div v-else key="history">
                <div v-if="portfolio.orders.length === 0"
                  class="bg-white rounded-2xl border border-slate-100 shadow-sm p-12 text-center">
                  <ClipboardList class="w-10 h-10 mx-auto text-slate-300 mb-3" />
                  <p class="text-brand-muted text-sm">尚無交易紀錄</p>
                </div>
                <div v-else class="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
                  <table class="w-full text-sm">
                    <thead>
                      <tr class="border-b border-slate-100 bg-slate-50">
                        <th v-for="col in orderCols" :key="col"
                          class="px-4 py-3 text-left text-xs font-semibold text-brand-muted">
                          {{ col }}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="o in portfolio.orders" :key="o.id"
                        class="border-b border-slate-50 last:border-0">
                        <td class="px-4 py-3 text-xs text-brand-muted whitespace-nowrap">{{ o.timestamp }}</td>
                        <td class="px-4 py-3">
                          <span class="px-2 py-0.5 rounded-md text-xs font-bold"
                            :class="o.type === 'buy'
                              ? 'bg-red-50 text-stock-up'
                              : 'bg-green-50 text-stock-down'">
                            {{ o.type === 'buy' ? '買入' : '賣出' }}
                          </span>
                        </td>
                        <td class="px-4 py-3">
                          <p class="font-semibold text-brand-primary">{{ o.name }}</p>
                          <p class="text-xs text-brand-muted">{{ o.code }}</p>
                        </td>
                        <td class="px-4 py-3 font-mono text-center">{{ formatSharesDisplay(o.shares) }}</td>
                        <td class="px-4 py-3 font-mono text-right">{{ o.price.toFixed(2) }}</td>
                        <td class="px-4 py-3 text-right">
                          <p class="font-mono font-semibold"
                            :class="o.type === 'buy' ? 'text-stock-up' : 'text-stock-down'">
                            {{ o.type === 'buy' ? '−' : '+' }}{{ fmt(o.total) }}
                          </p>
                          <p class="text-xs text-brand-muted">手續費 {{ fmt(o.fee) }}</p>
                          <p v-if="o.tax > 0" class="text-xs text-brand-muted">證交稅 {{ fmt(o.tax) }}</p>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </Transition>
          </div>
        </div>
      </div>
    </Transition>

    <!-- ══ RESET CONFIRM MODAL ════════════════════════════ -->
    <Transition name="backdrop">
      <div v-if="confirmReset" class="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
        @click.self="confirmReset = false">
        <div class="bg-white rounded-2xl shadow-2xl p-7 w-full max-w-sm">
          <div class="text-center mb-5">
            <div class="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-3">
              <AlertTriangle class="w-6 h-6 text-red-500" />
            </div>
            <h3 class="font-bold text-brand-primary text-lg">確認重置帳戶？</h3>
            <p class="text-brand-muted text-sm mt-2">所有持股與交易紀錄將清除，無法復原</p>
          </div>
          <div class="flex gap-3">
            <button @click="confirmReset = false"
              class="flex-1 py-3 rounded-xl border border-slate-200 text-brand-muted font-medium hover:bg-slate-50">
              取消
            </button>
            <button @click="doReset"
              class="flex-1 py-3 rounded-xl bg-red-500 text-white font-bold hover:bg-red-600">
              確認重置
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- ══ TOAST ══════════════════════════════════════════ -->
    <div class="fixed bottom-6 right-6 z-50 space-y-2 pointer-events-none">
      <TransitionGroup name="toast">
        <div v-for="t in toasts" :key="t.id"
          class="flex items-start gap-3 px-4 py-3 rounded-2xl shadow-xl text-sm font-medium max-w-sm pointer-events-auto"
          :class="t.ok
            ? 'bg-brand-primary text-white'
            : 'bg-red-500 text-white'">
          <component :is="t.ok ? CheckCircle2 : AlertCircle" class="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>{{ t.msg }}</span>
        </div>
      </TransitionGroup>
    </div>

  </div>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import {
  Wallet, PiggyBank, Search, X, ShoppingCart,
  RotateCcw, AlertTriangle, CheckCircle2, AlertCircle,
  Inbox, ClipboardList, Receipt, Landmark, CircleDollarSign,
} from 'lucide-vue-next'
import { usePortfolioStore } from '@/stores/portfolio'
import { searchStocks, findStock, getMockPrice, getMockPrevPrice } from '@/data/twStocks'

const portfolio = usePortfolioStore()

// ── Setup ─────────────────────────────────────────────────
const setupAmount  = ref(1000000)
const confirmReset = ref(false)

const capitalPresets = [
  { label: '10萬',  value: 100000 },
  { label: '50萬',  value: 500000 },
  { label: '100萬', value: 1000000 },
  { label: '500萬', value: 5000000 },
]

function doSetup() {
  if (!setupAmount.value || setupAmount.value < 10000) return
  portfolio.setup(setupAmount.value)
}

function doReset() {
  portfolio.reset()
  confirmReset.value = false
  activeStock.value  = null
  query.value        = ''
  qty.value          = 1
  tradeMode.value    = 'lot'
}

// ── Asset summary stats ────────────────────────────────────
const summaryStats = computed(() => [
  {
    label: '可用現金',
    value: `${fmt(portfolio.cash)} 元`,
    sub:   `${((portfolio.cash / portfolio.capital) * 100).toFixed(1)}% 現金比例`,
  },
  {
    label: '持股市值',
    value: `${fmt(portfolio.totalHoldingsValue)} 元`,
    sub:   `${portfolio.holdings.length} 檔個股`,
  },
  {
    label: '初始資金',
    value: `${fmt(portfolio.capital)} 元`,
    sub:   `${portfolio.orders.length} 筆交易`,
  },
])

// ── Fee / Tax cumulative stats ─────────────────────────────
const totalFeesPaid = computed(() => portfolio.orders.reduce((s, o) => s + o.fee, 0))
const totalTaxPaid  = computed(() => portfolio.orders.reduce((s, o) => s + (o.tax || 0), 0))

const feeStats = computed(() => {
  const total = totalFeesPaid.value + totalTaxPaid.value
  const pct   = portfolio.capital > 0
    ? ((total / portfolio.capital) * 100).toFixed(3)
    : '0.000'
  return [
    {
      label:     '累計手續費',
      value:     totalFeesPaid.value,
      note:      '買賣雙向收取 0.1425%',
      icon:      Receipt,
      iconBg:    'bg-amber-100',
      iconColor: 'text-amber-600',
    },
    {
      label:     '累計證交稅',
      value:     totalTaxPaid.value,
      note:      '賣出時收取 0.3%（ETF 0.1%）',
      icon:      Landmark,
      iconBg:    'bg-orange-100',
      iconColor: 'text-orange-600',
    },
    {
      label:     '合計摩擦成本',
      value:     total,
      note:      `佔初始資金 ${pct}%`,
      icon:      CircleDollarSign,
      iconBg:    'bg-red-100',
      iconColor: 'text-red-500',
    },
  ]
})

// ── Stock search ───────────────────────────────────────────
const query        = ref('')
const searchResults = ref([])
const searchFocused = ref(false)
const showDrop     = ref(false)
const hlIdx        = ref(0)
const searchInput  = ref(null)
const activeStock  = ref(null)

watch(query, (q) => {
  searchResults.value = searchStocks(q)
  hlIdx.value         = 0
  showDrop.value      = q.trim().length > 0
})

function moveHL(dir) {
  const len = searchResults.value.length
  if (!len) return
  hlIdx.value = (hlIdx.value + dir + len) % len
}
function pickHL() {
  if (searchResults.value[hlIdx.value]) pickStock(searchResults.value[hlIdx.value])
}
function onSearchBlur() {
  searchFocused.value = false
  setTimeout(() => { showDrop.value = false }, 150)
}
function clearSearch() {
  query.value      = ''
  activeStock.value = null
  searchInput.value?.focus()
}
function pickStock(stock) {
  activeStock.value   = stock
  query.value         = `${stock.code} ${stock.name}`
  showDrop.value      = false
  searchFocused.value = false
  orderType.value     = 'buy'
  qty.value           = 1
}
function quickSelect(code) {
  const stock = findStock(code)
  if (stock) pickStock(stock)
  activeTab.value = '持股明細'
}

// ── Price ──────────────────────────────────────────────────
const mockPrice = computed(() =>
  activeStock.value ? getMockPrice(activeStock.value) : 0
)
const prevPrice = computed(() =>
  activeStock.value ? getMockPrevPrice(activeStock.value) : 0
)
const priceChange    = computed(() => mockPrice.value - prevPrice.value)
const priceChangePct = computed(() =>
  prevPrice.value > 0 ? (priceChange.value / prevPrice.value) * 100 : 0
)

const currentHolding = computed(() =>
  activeStock.value ? portfolio.getHolding(activeStock.value.code) : null
)

// ── Order form ─────────────────────────────────────────────
const orderType  = ref('buy')
const tradeMode  = ref('lot')   // 'lot' = 整張, 'share' = 零股
const qty        = ref(1)       // 整張模式為張數；零股模式為股數
const activeTab  = ref('持股明細')

watch(tradeMode, () => { qty.value = 1 })

// 實際股數：整張 × 1000，零股直接用股數
const actualShares = computed(() =>
  tradeMode.value === 'lot' ? qty.value * 1000 : qty.value
)

function formatSharesDisplay(shares) {
  const l = Math.floor(shares / 1000)
  const r = shares % 1000
  if (l > 0 && r > 0) return `${l} 張 ${r} 股`
  if (l > 0) return `${l} 張`
  return `${r} 股`
}

const isETF = computed(() =>
  activeStock.value
    ? ['0050','0056','00878','006208'].includes(activeStock.value.code)
    : false
)

const faceAmount = computed(() => actualShares.value * mockPrice.value)
const fee        = computed(() => portfolio.calcFee(faceAmount.value))
const tax        = computed(() =>
  orderType.value === 'sell' ? portfolio.calcTax(faceAmount.value, activeStock.value?.code ?? '') : 0
)
const totalAmount = computed(() =>
  orderType.value === 'buy'
    ? faceAmount.value + fee.value
    : faceAmount.value - fee.value - tax.value
)

const validationMsg = computed(() => {
  if (!activeStock.value || qty.value < 1) return ''
  if (orderType.value === 'buy' && portfolio.cash < totalAmount.value) {
    return `現金不足，需 ${fmt(totalAmount.value)} 元（可用 ${fmt(portfolio.cash)} 元）`
  }
  if (orderType.value === 'sell') {
    const h = portfolio.getHolding(activeStock.value.code)
    const held = h?.shares ?? 0
    if (held < actualShares.value) {
      return `持股不足（目前持有 ${formatSharesDisplay(held)}）`
    }
  }
  return ''
})

const canOrder = computed(() =>
  activeStock.value && qty.value >= 1 && !validationMsg.value
)

// ── Place order ────────────────────────────────────────────
function placeOrder() {
  if (!canOrder.value) return
  const result = orderType.value === 'buy'
    ? portfolio.buy(activeStock.value, actualShares.value, mockPrice.value)
    : portfolio.sell(activeStock.value, actualShares.value, mockPrice.value)
  showToast(result.ok, result.msg)
  if (result.ok) qty.value = 1
}

// ── Toast ──────────────────────────────────────────────────
const toasts = ref([])

function showToast(ok, msg) {
  const id = Date.now()
  toasts.value.push({ id, ok, msg })
  setTimeout(() => {
    toasts.value = toasts.value.filter(t => t.id !== id)
  }, 4000)
}

// ── Table columns ──────────────────────────────────────────
const holdingCols = ['個股', '持有量', '均成本', '現價', '市值', '損益']
const orderCols   = ['時間', '方向', '個股', '數量', '成交價', '金額']

// ── Formatters ─────────────────────────────────────────────
function fmt(n) {
  return Math.round(n).toLocaleString('zh-TW')
}
</script>

<style scoped>
.dropdown-enter-active,
.dropdown-leave-active { transition: all 0.15s ease; }
.dropdown-enter-from,
.dropdown-leave-to     { opacity: 0; transform: translateY(-4px); }

.fade-enter-active,
.fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from,
.fade-leave-to     { opacity: 0; }

.backdrop-enter-active,
.backdrop-leave-active { transition: opacity 0.2s ease; }
.backdrop-enter-from,
.backdrop-leave-to     { opacity: 0; }

.toast-enter-active  { transition: all 0.3s cubic-bezier(0.34,1.56,0.64,1); }
.toast-leave-active  { transition: all 0.2s ease; }
.toast-enter-from    { opacity: 0; transform: translateY(16px) scale(0.95); }
.toast-leave-to      { opacity: 0; transform: translateX(100%); }
.toast-move          { transition: transform 0.3s ease; }
</style>
