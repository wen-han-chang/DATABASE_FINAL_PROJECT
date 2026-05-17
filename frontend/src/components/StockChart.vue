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
        <span v-if="olderHistoryHint" class="text-[11px] text-slate-400">
          {{ olderHistoryHint }}
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

      <!-- Overlay indicator toggles -->
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
        <button
          @click="bollVisible = !bollVisible; redraw()"
          class="px-2 py-0.5 rounded text-[11px] font-medium border transition-all"
          :class="bollVisible
            ? 'bg-slate-700 border-slate-700 text-white'
            : 'border-slate-200 text-slate-400 hover:border-slate-400'"
        >
          BB Band
        </button>
      </div>

      <!-- Sub-chart indicator toggles -->
      <div class="flex bg-slate-100 rounded-lg p-1 gap-0.5">
        <button
          v-for="indicator in subIndicators"
          :key="indicator.key"
          @click="activeSubIndicator = indicator.key"
          class="px-3 py-1 rounded-md text-xs font-semibold transition-all"
          :class="activeSubIndicator === indicator.key
            ? 'bg-white text-brand-primary shadow-sm'
            : 'text-brand-muted hover:text-brand-primary'"
        >
          {{ indicator.label }}
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

function calcEMA(values, period) {
  const multiplier = 2 / (period + 1)
  const result = []
  let prev = null

  values.forEach((value, index) => {
    if (index < period - 1) {
      result.push(null)
      return
    }

    if (index === period - 1) {
      const seed = values.slice(0, period).reduce((sum, current) => sum + current, 0) / period
      prev = seed
      result.push(+seed.toFixed(4))
      return
    }

    prev = ((value - prev) * multiplier) + prev
    result.push(+prev.toFixed(4))
  })

  return result
}

function calcBollinger(closes, period = 20, multiplier = 2) {
  const middle = calcMA(closes, period)
  const calcBand = (direction) => closes.map((_, index) => {
    if (index < period - 1) return null
    const window = closes.slice(index - period + 1, index + 1)
    const mean = middle[index]
    const variance = window.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / period
    return +(mean + (direction * Math.sqrt(variance) * multiplier)).toFixed(2)
  })

  return {
    middle,
    upper: calcBand(1),
    lower: calcBand(-1),
  }
}

function calcKD(candles, period = 9) {
  const k = []
  const d = []
  let prevK = 50
  let prevD = 50

  candles.forEach((candle, index) => {
    if (index < period - 1) {
      k.push(null)
      d.push(null)
      return
    }

    const window = candles.slice(index - period + 1, index + 1)
    const highest = Math.max(...window.map(item => item.high))
    const lowest = Math.min(...window.map(item => item.low))
    const rsv = highest === lowest ? 50 : ((candle.close - lowest) / (highest - lowest)) * 100

    prevK = ((2 / 3) * prevK) + ((1 / 3) * rsv)
    prevD = ((2 / 3) * prevD) + ((1 / 3) * prevK)

    k.push(+prevK.toFixed(2))
    d.push(+prevD.toFixed(2))
  })

  return { k, d }
}

function calcRSI(closes, period = 14) {
  const result = Array(closes.length).fill(null)
  if (closes.length <= period) return result

  let gains = 0
  let losses = 0

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff >= 0) gains += diff
    else losses -= diff
  }

  let avgGain = gains / period
  let avgLoss = losses / period
  result[period] = avgLoss === 0 ? 100 : +(100 - (100 / (1 + (avgGain / avgLoss)))).toFixed(2)

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    const gain = Math.max(diff, 0)
    const loss = Math.max(-diff, 0)
    avgGain = ((avgGain * (period - 1)) + gain) / period
    avgLoss = ((avgLoss * (period - 1)) + loss) / period
    result[i] = avgLoss === 0 ? 100 : +(100 - (100 / (1 + (avgGain / avgLoss)))).toFixed(2)
  }

  return result
}

function calcMACD(closes) {
  const ema12 = calcEMA(closes, 12)
  const ema26 = calcEMA(closes, 26)
  const dif = closes.map((_, index) => {
    if (ema12[index] == null || ema26[index] == null) return null
    return +(ema12[index] - ema26[index]).toFixed(4)
  })

  const signal = []
  let prev = null
  const multiplier = 2 / 10

  dif.forEach((value, index) => {
    if (value == null) {
      signal.push(null)
      return
    }

    const available = dif.slice(0, index + 1).filter(item => item != null)
    if (available.length < 9) {
      signal.push(null)
      return
    }

    if (available.length === 9) {
      prev = available.reduce((sum, item) => sum + item, 0) / 9
      signal.push(+prev.toFixed(4))
      return
    }

    prev = ((value - prev) * multiplier) + prev
    signal.push(+prev.toFixed(4))
  })

  return {
    dif,
    signal,
    histogram: dif.map((value, index) => (
      value == null || signal[index] == null ? null : +(value - signal[index]).toFixed(4)
    )),
  }
}

// ─────────────────────────────────────────────
// Component state
// ─────────────────────────────────────────────
const chartEl      = ref(null)
const chart        = shallowRef(null)
const activePeriod = ref('day')
const activeSubIndicator = ref('vol')
const bollVisible = ref(false)

// 圖表資料只顯示 TWSE 真實資料。
// 第一次看某檔時先拿近期真實資料；完整 13 個月歷史由前端另發背景請求補齊。
// 之後使用者把圖表拖到最左側時，再按需往前補 12 個月。
const dailyData       = shallowRef([])
const dataSourceLabel = ref('真實歷史資料載入中')
const historyStatus   = ref('loading')
const historyMessage  = ref('真實歷史資料載入中...')
const loadingOlderHistory = ref(false)
const noMoreOlderHistory   = ref(false)
const olderHistoryHint     = ref('')
let loadSeq = 0
let fullLoadTimer = null

function stopFullLoadTimer() {
  if (fullLoadTimer) {
    clearTimeout(fullLoadTimer)
    fullLoadTimer = null
  }
}

function applyHistoryResponse(res) {
  historyStatus.value = res?.historyStatus || 'loading'

  if (res?.data?.length) {
    dailyData.value = res.data
    const source = String(res?.source || '')
    const providerLabel = source.includes('finmind')
      ? 'FinMind'
      : source.includes('twse')
        ? 'TWSE'
        : '行情'
    if (historyStatus.value === 'complete') {
      dataSourceLabel.value = `來源:資料庫(${providerLabel} 歷史)`
      historyMessage.value = ''
    } else {
      dataSourceLabel.value = `來源:${providerLabel} 近期真實資料`
      historyMessage.value = ''
    }
  } else {
    dailyData.value = []
    dataSourceLabel.value = '真實歷史資料載入中'
    historyMessage.value = '真實歷史資料載入中...'
  }

  redraw()
}

function loadFullHistoryInBackground(seq) {
  fullLoadTimer = setTimeout(async () => {
    if (seq !== loadSeq) return

    try {
      const res = await getDbBars(props.stock.code)
      if (seq !== loadSeq) return
      if (res?.data?.length) applyHistoryResponse(res)
    } catch {
      // 背景完整資料失敗時不干擾近期圖表，使用者仍可看到近期真實 K 線。
    }
  }, 1500)
}

async function loadData() {
  const seq = ++loadSeq
  stopFullLoadTimer()
  dailyData.value = []
  historyStatus.value = 'loading'
  dataSourceLabel.value = '真實歷史資料載入中'
  historyMessage.value = '真實歷史資料載入中...'
  loadingOlderHistory.value = false
  noMoreOlderHistory.value = false
  olderHistoryHint.value = ''
  redraw()

  try {
    const res = await getDbBars(props.stock.code, { quick: 1 })
    if (seq !== loadSeq) return
    applyHistoryResponse(res)
    loadFullHistoryInBackground(seq)
  } catch {
    if (seq !== loadSeq) return
    dailyData.value = []
    dataSourceLabel.value = '真實資料暫時無法取得'
    historyMessage.value = '後端連線中斷，無法取得真實歷史資料'
    redraw()
  }
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

const subIndicators = [
  { key: 'vol', label: 'VOL' },
  { key: 'kd', label: 'KD' },
  { key: 'rsi', label: 'RSI' },
  { key: 'macd', label: 'MACD' },
]

const UP   = '#EF4444'
const DOWN = '#22C55E'

function getActiveCandles() {
  return aggregateCandles(dailyData.value, activePeriod.value)
}

function captureVisibleRange() {
  const candles = getActiveCandles()
  const zoom = chart.value?.getOption()?.dataZoom?.[0]
  if (!candles.length || !zoom) return null

  const last = Math.max(candles.length - 1, 1)
  const startIdx = Math.max(0, Math.min(
    candles.length - 1,
    Math.round((Number(zoom.start ?? 0) / 100) * last),
  ))
  const endIdx = Math.max(startIdx, Math.min(
    candles.length - 1,
    Math.round((Number(zoom.end ?? 100) / 100) * last),
  ))

  return {
    startDate: candles[startIdx]?.date,
    endDate: candles[endIdx]?.date,
  }
}

function zoomRangeFromVisibleDates(range) {
  if (!range?.startDate || !range?.endDate) return null
  const candles = getActiveCandles()
  if (!candles.length) return null

  const startIdx = candles.findIndex((c) => c.date === range.startDate)
  const endIdx = candles.findIndex((c) => c.date === range.endDate)
  if (startIdx < 0 || endIdx < 0) return null

  const last = Math.max(candles.length - 1, 1)
  return {
    start: +(startIdx / last * 100).toFixed(4),
    end: +(endIdx / last * 100).toFixed(4),
  }
}

function mergeBars(existingBars, incomingBars) {
  const byDate = new Map()
  for (const bar of [...incomingBars, ...existingBars]) byDate.set(bar.date, bar)
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

async function loadOlderHistory() {
  if (
    loadingOlderHistory.value ||
    noMoreOlderHistory.value ||
    historyStatus.value !== 'complete'
  ) {
    return
  }

  const earliestDate = dailyData.value[0]?.date
  if (!earliestDate) return

  const visibleRange = captureVisibleRange()
  loadingOlderHistory.value = true
  olderHistoryHint.value = '載入更早資料中...'

  try {
    const res = await getDbBars(props.stock.code, {
      before: earliestDate,
      months: 12,
    })

    if (!res?.data?.length) {
      noMoreOlderHistory.value = true
      olderHistoryHint.value = '已無更早資料'
      return
    }

    dailyData.value = mergeBars(dailyData.value, res.data)
    noMoreOlderHistory.value = res.hasMoreBefore === false
    olderHistoryHint.value = noMoreOlderHistory.value ? '已無更早資料' : ''
    redraw(zoomRangeFromVisibleDates(visibleRange))
  } catch {
    olderHistoryHint.value = '更早資料載入失敗'
  } finally {
    loadingOlderHistory.value = false
  }
}

function maybeLoadOlderHistory() {
  const zoom = chart.value?.getOption()?.dataZoom?.[0]
  const start = Number(zoom?.start ?? 100)
  if (start <= 1) loadOlderHistory()
}

function buildOption(zoomRange = null) {
  const rawData = dailyData.value
  const candles = aggregateCandles(rawData, activePeriod.value)
  const dates   = candles.map(c => c.date)
  const closes  = candles.map(c => c.close)
  const kData   = candles.map(c => [c.open, c.close, c.low, c.high])
  const volumes = candles.map(c => ({
    value: c.volume,
    itemStyle: { color: c.close >= c.open ? UP : DOWN, opacity: 0.6 },
  }))
  const bollinger = calcBollinger(closes)
  const kd = calcKD(candles)
  const rsi = calcRSI(closes)
  const macd = calcMACD(closes)

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
  const overlaySeries = [
    ...activeMAs,
    ...(bollVisible.value ? [
      {
        name: 'BB Mid',
        type: 'line',
        data: bollinger.middle,
        smooth: false,
        symbol: 'none',
        lineStyle: { width: 1.2, color: '#64748B' },
        itemStyle: { color: '#64748B' },
        connectNulls: false,
        z: 4,
      },
      {
        name: 'BB Upper',
        type: 'line',
        data: bollinger.upper,
        smooth: false,
        symbol: 'none',
        lineStyle: { width: 1.2, color: '#0F172A', type: 'dashed' },
        itemStyle: { color: '#0F172A' },
        connectNulls: false,
        z: 4,
      },
      {
        name: 'BB Lower',
        type: 'line',
        data: bollinger.lower,
        smooth: false,
        symbol: 'none',
        lineStyle: { width: 1.2, color: '#0F172A', type: 'dashed' },
        itemStyle: { color: '#0F172A' },
        connectNulls: false,
        z: 4,
      },
    ] : []),
  ]
  const defaultZoomStart = historyStatus.value === 'complete' && dates.length > 60 ? 65 : 0
  const zoomStart = zoomRange?.start ?? defaultZoomStart
  const zoomEnd = zoomRange?.end ?? 100
  const loadingGraphic = historyMessage.value
    ? [{
        type: 'text',
        right: 20,
        top: dates.length ? 18 : '42%',
        style: {
          text: historyMessage.value,
          fill: '#64748B',
          fontSize: 12,
          fontWeight: 600,
          backgroundColor: 'rgba(255,255,255,0.88)',
          borderColor: '#E2E8F0',
          borderWidth: 1,
          borderRadius: 8,
          padding: [7, 10],
        },
      }]
    : []

  return {
    backgroundColor: '#ffffff',
    animation:       false,
    graphic:         loadingGraphic,
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
        // ECharts 蠟燭圖在類別軸下，k.value 可能是 [索引, 開, 收, 低, 高]（最前面多一個 x 索引），
        // k.data 才是原始的 [開, 收, 低, 高]。優先用 k.data；退而求其次取末 4 個避免位移。
        const raw = Array.isArray(k.data) && k.data.length >= 4 ? k.data : k.value
        const [o, c, l, h] = raw.slice(-4)
        // 台股慣例：開、高、低、收各自和「前一交易日收盤價」比較上色：
        //   > 前日收 → 紅(漲)；< 前日收 → 綠(跌)；= 前日收 → 白(預設色，不上色)
        // 前一交易日收盤 = 同序列前一根 K 的收盤（candles 與此 formatter 同作用域）。
        const idx = k.dataIndex
        const prevClose = idx > 0 && candles[idx - 1] ? candles[idx - 1].close : null
        const colorOf = (v) => {
          if (prevClose == null || v === prevClose) return '' // 等於或無前日 → 白(預設)
          return v > prevClose ? UP : DOWN
        }
        const cellStyle = (v, bold) => {
          const col = colorOf(v)
          return `padding-left:8px;${bold ? 'font-weight:700;' : ''}${col ? `color:${col};` : ''}`
        }
        // 標題箭頭依「收盤 vs 前日收盤」；等於或無前日資料則不顯示箭頭
        const arrow = prevClose == null || c === prevClose
          ? ''
          : c > prevClose
            ? `<span style="color:${UP}">▲</span>`
            : `<span style="color:${DOWN}">▼</span>`
        let html = `<div style="font-weight:700;margin-bottom:6px">${k.name} ${arrow}</div>`
        html += `<table style="font-size:11px;line-height:2;border-spacing:0">
          <tr><td style="color:#94A3B8">開&nbsp;</td><td style="${cellStyle(o)}">${o}</td></tr>
          <tr><td style="color:#94A3B8">高&nbsp;</td><td style="${cellStyle(h)}">${h}</td></tr>
          <tr><td style="color:#94A3B8">低&nbsp;</td><td style="${cellStyle(l)}">${l}</td></tr>
          <tr><td style="color:#94A3B8">收&nbsp;</td><td style="${cellStyle(c, true)}">${c}</td></tr>
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
        axisLabel: {
          show: activeSubIndicator.value !== 'vol',
          color: '#94A3B8',
          fontSize: 10,
        },
        splitLine: {
          show: activeSubIndicator.value !== 'vol',
          lineStyle: { color: '#F1F5F9', type: 'dashed' },
        },
      },
    ],
    dataZoom: [
      { type: 'inside', xAxisIndex: [0, 1], start: zoomStart, end: zoomEnd, minSpan: 3 },
      {
        type: 'slider', xAxisIndex: [0, 1], bottom: 4, height: 22,
        start: zoomStart, end: zoomEnd,
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
      ...overlaySeries,
      ...(activeSubIndicator.value === 'vol' ? [
        {
          name: '成交量', type: 'bar',
          xAxisIndex: 1, yAxisIndex: 1, data: volumes, barMaxWidth: 8,
        },
      ] : []),
      ...(activeSubIndicator.value === 'kd' ? [
        {
          name: 'K',
          type: 'line',
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: kd.k,
          symbol: 'none',
          lineStyle: { width: 1.5, color: '#F59E0B' },
          itemStyle: { color: '#F59E0B' },
        },
        {
          name: 'D',
          type: 'line',
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: kd.d,
          symbol: 'none',
          lineStyle: { width: 1.5, color: '#3B82F6' },
          itemStyle: { color: '#3B82F6' },
        },
      ] : []),
      ...(activeSubIndicator.value === 'rsi' ? [
        {
          name: 'RSI14',
          type: 'line',
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: rsi,
          symbol: 'none',
          lineStyle: { width: 1.5, color: '#8B5CF6' },
          itemStyle: { color: '#8B5CF6' },
        },
      ] : []),
      ...(activeSubIndicator.value === 'macd' ? [
        {
          name: 'MACD Hist',
          type: 'bar',
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: macd.histogram.map(value => ({
            value,
            itemStyle: {
              color: value == null
                ? 'transparent'
                : value >= 0
                  ? 'rgba(239,68,68,0.7)'
                  : 'rgba(34,197,94,0.7)',
            },
          })),
          barMaxWidth: 8,
        },
        {
          name: 'DIF',
          type: 'line',
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: macd.dif,
          symbol: 'none',
          lineStyle: { width: 1.4, color: '#F59E0B' },
          itemStyle: { color: '#F59E0B' },
        },
        {
          name: 'DEA',
          type: 'line',
          xAxisIndex: 1,
          yAxisIndex: 1,
          data: macd.signal,
          symbol: 'none',
          lineStyle: { width: 1.4, color: '#3B82F6' },
          itemStyle: { color: '#3B82F6' },
        },
      ] : []),
    ],
  }
}

function redraw(zoomRange = null) {
  chart.value?.setOption(buildOption(zoomRange), { notMerge: true })
}

watch(activePeriod, redraw)
watch(activeSubIndicator, redraw)

// 換股票時，重新跟後端要該檔的資料
watch(() => props.stock.code, () => {
  activePeriod.value = 'day'
  loadData()
})

let resizeObserver = null

onMounted(() => {
  chart.value = echarts.init(chartEl.value, null, { renderer: 'canvas' })
  chart.value.on('datazoom', maybeLoadOlderHistory)
  chart.value.setOption(buildOption())   // 先顯示「真實歷史資料載入中」狀態
  loadData()                              // 先抓近期真實資料，再輪詢完整歷史
  resizeObserver = new ResizeObserver(() => chart.value?.resize())
  resizeObserver.observe(chartEl.value)
})

onBeforeUnmount(() => {
  stopFullLoadTimer()
  chart.value?.off('datazoom', maybeLoadOlderHistory)
  resizeObserver?.disconnect()
  chart.value?.dispose()
})
</script>
