<template>
  <div class="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
    <!-- Toolbar -->
    <div class="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-100">
      <div class="flex items-center gap-2">
        <span class="font-bold text-brand-primary text-sm">{{ stock.code }}</span>
        <span class="text-xs text-brand-muted">{{ stock.name }} · {{ dataSourceLabel }}</span>
        <span class="text-[11px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
          {{ stock.sector }}
        </span>
      </div>

      <!-- Period toggle -->
      <div class="flex bg-slate-100 rounded-lg p-1 gap-0.5">
        <button
          v-for="p in periods" :key="p.key"
          @click="activePeriod = p.key"
          class="px-3 py-1 rounded-md text-xs font-semibold transition-all"
          :class="activePeriod === p.key
            ? 'bg-brand-primary text-white shadow-sm'
            : 'text-brand-muted hover:text-brand-primary'"
        >
          {{ p.label }}
        </button>
      </div>

      <!-- MA toggles -->
      <div class="flex gap-1.5 flex-wrap">
        <button
          v-for="ma in maList" :key="ma.key"
          @click="ma.visible = !ma.visible; redraw()"
          class="px-2 py-0.5 rounded text-[11px] font-medium border transition-all"
          :style="ma.visible ? { backgroundColor: ma.color, borderColor: ma.color, color: '#fff' } : {}"
          :class="ma.visible ? '' : 'border-slate-200 text-slate-400 hover:border-slate-400'"
        >
          {{ ma.name }}
        </button>
      </div>
    </div>

    <!-- 即時報價條（圖表本身不變，只是上方多一條準即時數值） -->
    <div class="px-4 py-2 border-b border-slate-100">
      <LiveQuote :code="stock.code" />
    </div>

    <!-- Chart -->
    <div ref="chartEl" :style="{ height: height + 'px', width: '100%' }" />
  </div>
</template>

<script setup>
import { ref, reactive, watch, onMounted, onBeforeUnmount, shallowRef } from 'vue'
import * as echarts from 'echarts'
import { seedFromCode } from '@/data/twStocks'
import { getDbBars } from '@/services/twseApi'
import LiveQuote from '@/components/LiveQuote.vue'

const props = defineProps({
  stock: {
    type: Object,
    default: () => ({ code: '2330', name: '台積電', price: 580, vol: 0.020, sector: '半導體' }),
  },
  height: {
    type: Number,
    default: 460,
  },
})

// ─────────────────────────────────────────────
// Mock data generator (Mulberry32 seeded PRNG)
// ─────────────────────────────────────────────
function mulberry32(seed) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function boxMuller(rand) {
  const u1 = Math.max(rand(), 1e-10)
  const u2 = rand()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

function generateDailyData(stock) {
  const n          = 300
  const startPrice = stock.price
  const volatility = stock.vol ?? 0.018
  const seed       = seedFromCode(stock.code)
  const rand       = mulberry32(seed)

  const endDate = new Date('2025-04-30')
  const tradingDates = []
  const cur = new Date(endDate)
  while (tradingDates.length < n) {
    const dow = cur.getDay()
    if (dow !== 0 && dow !== 6) tradingDates.unshift(cur.toISOString().slice(0, 10))
    cur.setDate(cur.getDate() - 1)
  }

  let prevClose = startPrice
  let momentum  = 0
  const data    = []

  for (let i = 0; i < n; i++) {
    const vol       = volatility * (0.8 + rand() * 0.7)
    const logReturn = 0.0003 + momentum * 0.001 + vol * boxMuller(rand)
    const open      = prevClose
    const close     = prevClose * Math.exp(logReturn)
    const wick      = Math.abs(close - open) + prevClose * vol * 0.8
    const high      = Math.max(open, close) + wick * (0.1 + rand() * 0.5)
    const low       = Math.min(open, close) - wick * (0.1 + rand() * 0.5)
    const volume    = Math.round(50000 * (1 + Math.abs(logReturn) * 12) * (0.5 + rand()))

    data.push({
      date:   tradingDates[i],
      open:   +open.toFixed(2),
      high:   +high.toFixed(2),
      low:    +low.toFixed(2),
      close:  +close.toFixed(2),
      volume,
    })

    momentum  = momentum * 0.93 + logReturn
    prevClose = close
  }
  return data
}

function aggregateCandles(daily, mode) {
  if (mode === 'day') return daily
  const groups = {}
  for (const bar of daily) {
    const d = new Date(bar.date)
    let key
    if (mode === 'week') {
      const diff = (d.getDay() === 0 ? -6 : 1) - d.getDay()
      const mon  = new Date(d)
      mon.setDate(d.getDate() + diff)
      key = mon.toISOString().slice(0, 10)
    } else {
      key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
    }
    if (!groups[key]) groups[key] = []
    groups[key].push(bar)
  }
  return Object.entries(groups)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, bars]) => ({
      date,
      open:   bars[0].open,
      high:   Math.max(...bars.map(b => b.high)),
      low:    Math.min(...bars.map(b => b.low)),
      close:  bars.at(-1).close,
      volume: bars.reduce((s, b) => s + b.volume, 0),
    }))
}

function calcMA(closes, period) {
  return closes.map((_, i) => {
    if (i < period - 1) return null
    const sum = closes.slice(i - period + 1, i + 1).reduce((s, v) => s + v, 0)
    return +(sum / period).toFixed(2)
  })
}

// ─────────────────────────────────────────────
// Component state
// ─────────────────────────────────────────────
const chartEl      = ref(null)
const chart        = shallowRef(null)
const activePeriod = ref('day')

// 圖表資料：優先從後端資料庫(stock_daily_bars)取得；
// 後端沒開或查不到時，自動退回前端自己產生，確保圖表永遠畫得出來。
const dailyData       = shallowRef([])
const dataSourceLabel = ref('模擬資料')

async function loadData() {
  try {
    const res = await getDbBars(props.stock.code)
    if (res?.data?.length) {
      dailyData.value = res.data
      // 後端會把該檔換成 TWSE 真實歷史並存進資料庫，故標示來源為資料庫
      dataSourceLabel.value = '來源:資料庫(TWSE 歷史)'
    } else {
      // 資料庫沒有這檔（例如不在已灌入的 50 檔）→ 退回前端產生
      dailyData.value = generateDailyData(props.stock)
      dataSourceLabel.value = '模擬資料（備援）'
    }
  } catch {
    // 後端未啟動或連線失敗 → 退回前端產生，畫面不中斷
    dailyData.value = generateDailyData(props.stock)
    dataSourceLabel.value = '模擬資料（後端未連，備援）'
  }
  redraw()
}

const periods = [
  { key: 'day',   label: '日K' },
  { key: 'week',  label: '週K' },
  { key: 'month', label: '月K' },
]

const maList = reactive([
  { key: 'ma5',   name: 'MA5',   period: 5,   color: '#F59E0B', visible: true  },
  { key: 'ma10',  name: 'MA10',  period: 10,  color: '#8B5CF6', visible: true  },
  { key: 'ma20',  name: 'MA20',  period: 20,  color: '#3B82F6', visible: true  },
  { key: 'ma60',  name: 'MA60',  period: 60,  color: '#EC4899', visible: true  },
  { key: 'ma120', name: 'MA120', period: 120, color: '#14B8A6', visible: false },
  { key: 'ma240', name: 'MA240', period: 240, color: '#F97316', visible: false },
])

const UP   = '#EF4444'
const DOWN = '#22C55E'

function buildOption() {
  // 有從後端拿到資料就用；還沒拿到（首次渲染瞬間）先用前端產生的墊著
  const rawData = dailyData.value.length
    ? dailyData.value
    : generateDailyData(props.stock)
  const candles = aggregateCandles(rawData, activePeriod.value)
  const dates   = candles.map(c => c.date)
  const closes  = candles.map(c => c.close)
  const kData   = candles.map(c => [c.open, c.close, c.low, c.high])
  const volumes = candles.map(c => ({
    value: c.volume,
    itemStyle: { color: c.close >= c.open ? UP : DOWN, opacity: 0.6 },
  }))

  const activeMAs = maList
    .filter(m => m.visible)
    .map(m => ({
      name:      m.name,
      type:      'line',
      data:      calcMA(closes, m.period),
      smooth:    false,
      symbol:    'none',
      lineStyle: { width: 1.5, color: m.color },
      itemStyle: { color: m.color },
      connectNulls: false,
      z: 5,
    }))

  return {
    backgroundColor: '#ffffff',
    animation:       false,
    tooltip: {
      trigger:     'axis',
      axisPointer: {
        type:      'cross',
        lineStyle: { color: '#94A3B8', width: 1, type: 'dashed' },
      },
      backgroundColor: '#1E293B',
      borderColor:     '#334155',
      textStyle:       { color: '#F1F5F9', fontSize: 12 },
      formatter(params) {
        const k = params.find(p => p.seriesType === 'candlestick')
        if (!k) return ''
        const [o, c, l, h] = k.value
        const arrow = c >= o
          ? `<span style="color:${UP}">▲</span>`
          : `<span style="color:${DOWN}">▼</span>`
        let html = `<div style="font-weight:700;margin-bottom:6px">${k.name} ${arrow}</div>`
        html += `<table style="font-size:11px;line-height:2;border-spacing:0">
          <tr><td style="color:#94A3B8">開&nbsp;</td><td style="padding-left:8px">${o}</td></tr>
          <tr><td style="color:#94A3B8">高&nbsp;</td><td style="padding-left:8px;color:${UP}">${h}</td></tr>
          <tr><td style="color:#94A3B8">低&nbsp;</td><td style="padding-left:8px;color:${DOWN}">${l}</td></tr>
          <tr><td style="color:#94A3B8">收&nbsp;</td><td style="padding-left:8px;font-weight:700">${c}</td></tr>
        </table>`
        params.filter(p => p.seriesType === 'line' && p.value != null).forEach(p => {
          html += `<div style="color:${p.color};font-size:11px;margin-top:2px">${p.seriesName}: ${p.value}</div>`
        })
        return html
      },
    },
    grid: [
      { left: 64, right: 16, top: 12,    bottom: 110 },
      { left: 64, right: 16, top: '76%', bottom: 36  },
    ],
    xAxis: [
      {
        type:        'category',
        data:        dates,
        gridIndex:   0,
        boundaryGap: true,
        axisLine:    { lineStyle: { color: '#E2E8F0' } },
        axisTick:    { show: false },
        axisLabel:   { color: '#94A3B8', fontSize: 10, margin: 8 },
        splitLine:   { show: false },
      },
      { type: 'category', data: dates, gridIndex: 1, show: false },
    ],
    yAxis: [
      {
        scale:     true,
        gridIndex: 0,
        position:  'left',
        axisLine:  { show: false },
        axisTick:  { show: false },
        axisLabel: { color: '#94A3B8', fontSize: 10 },
        splitLine: { lineStyle: { color: '#F1F5F9', type: 'dashed' } },
        splitArea: {
          show: true,
          areaStyle: { color: ['rgba(248,250,252,0.5)', 'rgba(241,245,249,0.3)'] },
        },
      },
      {
        scale: true, gridIndex: 1,
        axisLine: { show: false }, axisTick: { show: false },
        axisLabel: { show: false }, splitLine: { show: false },
      },
    ],
    dataZoom: [
      { type: 'inside', xAxisIndex: [0, 1], start: 65, end: 100, minSpan: 3 },
      {
        type: 'slider', xAxisIndex: [0, 1], bottom: 4, height: 22,
        start: 65, end: 100,
        handleStyle: { color: '#3B82F6', borderColor: '#3B82F6' },
        fillerColor: 'rgba(59,130,246,0.1)',
        borderColor: '#E2E8F0',
        textStyle:   { color: '#94A3B8', fontSize: 10 },
      },
    ],
    series: [
      {
        name: 'K線', type: 'candlestick',
        xAxisIndex: 0, yAxisIndex: 0, data: kData,
        itemStyle: {
          color: UP, color0: DOWN,
          borderColor: UP, borderColor0: DOWN, borderWidth: 1,
        },
      },
      ...activeMAs,
      {
        name: '成交量', type: 'bar',
        xAxisIndex: 1, yAxisIndex: 1, data: volumes, barMaxWidth: 8,
      },
    ],
  }
}

function redraw() {
  chart.value?.setOption(buildOption(), { notMerge: true })
}

watch(activePeriod, redraw)

// 換股票時，重新跟後端要該檔的資料
watch(() => props.stock.code, () => {
  activePeriod.value = 'day'
  loadData()
})

let resizeObserver = null

onMounted(() => {
  chart.value = echarts.init(chartEl.value, null, { renderer: 'canvas' })
  chart.value.setOption(buildOption())   // 先用前端墊圖，畫面不空白
  loadData()                              // 再跟後端資料庫要正式資料並重畫
  resizeObserver = new ResizeObserver(() => chart.value?.resize())
  resizeObserver.observe(chartEl.value)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  chart.value?.dispose()
})
</script>
