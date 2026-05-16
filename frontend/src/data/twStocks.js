// 台灣上市主要個股清單（搜尋與下單練習參考用）
// price: 練習參考起始股價, vol: 個股波動率係數, sector: 產業別
export const TW_STOCKS = [
  { code: '2330', name: '台積電',   price: 580,  vol: 0.020, sector: '半導體' },
  { code: '2317', name: '鴻海',     price: 110,  vol: 0.022, sector: '電子製造' },
  { code: '2454', name: '聯發科',   price: 820,  vol: 0.028, sector: '半導體' },
  { code: '2882', name: '國泰金',   price: 52,   vol: 0.014, sector: '金融' },
  { code: '2881', name: '富邦金',   price: 78,   vol: 0.015, sector: '金融' },
  { code: '2412', name: '中華電',   price: 125,  vol: 0.010, sector: '電信' },
  { code: '1301', name: '台塑',     price: 68,   vol: 0.016, sector: '石化' },
  { code: '1303', name: '南亞',     price: 62,   vol: 0.016, sector: '石化' },
  { code: '2002', name: '中鋼',     price: 26,   vol: 0.018, sector: '鋼鐵' },
  { code: '2886', name: '兆豐金',   price: 38,   vol: 0.012, sector: '金融' },
  { code: '2884', name: '玉山金',   price: 28,   vol: 0.013, sector: '金融' },
  { code: '2891', name: '中信金',   price: 30,   vol: 0.013, sector: '金融' },
  { code: '2303', name: '聯電',     price: 48,   vol: 0.024, sector: '半導體' },
  { code: '3711', name: '日月光投控', price: 135, vol: 0.022, sector: '半導體封測' },
  { code: '2308', name: '台達電',   price: 295,  vol: 0.023, sector: '電源供應器' },
  { code: '2382', name: '廣達',     price: 280,  vol: 0.025, sector: '伺服器' },
  { code: '3008', name: '大立光',   price: 1820, vol: 0.030, sector: '光學' },
  { code: '2357', name: '華碩',     price: 385,  vol: 0.024, sector: '電腦' },
  { code: '2353', name: '宏碁',     price: 38,   vol: 0.022, sector: '電腦' },
  { code: '2395', name: '研華',     price: 310,  vol: 0.018, sector: '工業電腦' },
  { code: '4938', name: '和碩',     price: 72,   vol: 0.022, sector: '電子製造' },
  { code: '2379', name: '瑞昱',     price: 465,  vol: 0.026, sector: '半導體' },
  { code: '2408', name: '南亞科',   price: 58,   vol: 0.028, sector: '記憶體' },
  { code: '2376', name: '技嘉',     price: 155,  vol: 0.025, sector: '主機板' },
  { code: '2474', name: '可成',     price: 178,  vol: 0.020, sector: '機殼' },
  { code: '6505', name: '台塑化',   price: 88,   vol: 0.014, sector: '石化' },
  { code: '2207', name: '和泰車',   price: 580,  vol: 0.015, sector: '汽車' },
  { code: '2105', name: '正新',     price: 38,   vol: 0.016, sector: '橡膠' },
  { code: '1216', name: '統一',     price: 72,   vol: 0.012, sector: '食品' },
  { code: '2912', name: '統一超',   price: 272,  vol: 0.013, sector: '零售' },
  { code: '2327', name: '國巨',     price: 520,  vol: 0.030, sector: '被動元件' },
  { code: '2301', name: '光寶科',   price: 68,   vol: 0.020, sector: '電子' },
  { code: '3045', name: '台灣大',   price: 105,  vol: 0.011, sector: '電信' },
  { code: '4904', name: '遠傳',     price: 72,   vol: 0.011, sector: '電信' },
  { code: '5880', name: '合庫金',   price: 26,   vol: 0.012, sector: '金融' },
  { code: '2890', name: '永豐金',   price: 18,   vol: 0.014, sector: '金融' },
  { code: '1326', name: '台化',     price: 60,   vol: 0.015, sector: '石化' },
  { code: '2609', name: '陽明',     price: 42,   vol: 0.035, sector: '航運' },
  { code: '2603', name: '長榮',     price: 138,  vol: 0.035, sector: '航運' },
  { code: '2615', name: '萬海',     price: 48,   vol: 0.033, sector: '航運' },
  { code: '2618', name: '長榮航',   price: 28,   vol: 0.028, sector: '航空' },
  { code: '2610', name: '華航',     price: 18,   vol: 0.025, sector: '航空' },
  { code: '0050', name: '元大台灣50', price: 145, vol: 0.013, sector: 'ETF' },
  { code: '0056', name: '元大高股息', price: 38,  vol: 0.011, sector: 'ETF' },
  { code: '00878', name: '國泰永續高股息', price: 22, vol: 0.011, sector: 'ETF' },
  { code: '006208', name: '富邦台50', price: 88,  vol: 0.013, sector: 'ETF' },
  { code: '2347', name: '聯強',     price: 58,   vol: 0.018, sector: '通路' },
  { code: '3034', name: '聯詠',     price: 310,  vol: 0.028, sector: '半導體' },
  { code: '6415', name: '矽力-KY', price: 1380, vol: 0.032, sector: '半導體' },
  { code: '2356', name: '英業達',   price: 38,   vol: 0.020, sector: '伺服器' },
  { code: '3231', name: '緯創',     price: 68,   vol: 0.025, sector: '伺服器' },
  { code: '2385', name: '群光',     price: 105,  vol: 0.020, sector: '電子' },
  { code: '3037', name: '欣興',     price: 118,  vol: 0.028, sector: '電路板' },
  { code: '2344', name: '華邦電',   price: 22,   vol: 0.026, sector: '記憶體' },
  { code: '2360', name: '致茂',     price: 138,  vol: 0.022, sector: '量測' },
  // 機械 / 電機類
  { code: '2049', name: '上銀',     price: 340,  vol: 0.025, sector: '精密機械' },
  { code: '1504', name: '東元電機', price: 38,   vol: 0.018, sector: '電機' },
  { code: '1514', name: '亞力電機', price: 62,   vol: 0.020, sector: '電機' },
  { code: '1522', name: '堤維西',   price: 72,   vol: 0.020, sector: '機車零件' },
  { code: '2059', name: '川湖',     price: 520,  vol: 0.022, sector: '機架' },
  { code: '9921', name: '巨大',     price: 225,  vol: 0.018, sector: '機械製造' },
  { code: '1560', name: '中砂',     price: 88,   vol: 0.019, sector: '研磨機械' },
  { code: '1536', name: '和大',     price: 95,   vol: 0.021, sector: '機械傳動' },
  { code: '2114', name: '鑫永銓',   price: 42,   vol: 0.020, sector: '機械加工' },
  { code: '1590', name: '亞德客-KY', price: 680, vol: 0.023, sector: '氣動機械' },
]

// 用 code 數字當 PRNG seed（每支股票有唯一但一致的圖形）
export function seedFromCode(code) {
  return parseInt(code.replace(/\D/g, '')) || 1234
}

// 搜尋：名稱、代碼（含）、產業模糊匹配
export function searchStocks(query) {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const keywords = q.split(/\s+/).filter(Boolean)
  return TW_STOCKS.filter(
    s => keywords.every(
      k => s.code.includes(k) || s.name.toLowerCase().includes(k) || s.sector.toLowerCase().includes(k)
    )
  ).slice(0, 10)
}

export function findStock(code) {
  return TW_STOCKS.find(s => s.code === code) ?? null
}

// 取得下單練習參考收盤價（跑 300 步 PRNG，結果 memoize 避免重複運算）
const _priceCache = new Map()

export function getMockPrice(stock) {
  if (_priceCache.has(stock.code)) return _priceCache.get(stock.code)

  function mulberry32(seed) {
    return () => {
      seed |= 0
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }
  function bm(rand) {
    const u1 = Math.max(rand(), 1e-10), u2 = rand()
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  }

  const rand = mulberry32(seedFromCode(stock.code))
  const vol  = stock.vol ?? 0.018
  let p = stock.price, m = 0
  for (let i = 0; i < 300; i++) {
    const v  = vol * (0.8 + rand() * 0.7)
    const lr = 0.0003 + m * 0.001 + v * bm(rand)
    p = p * Math.exp(lr)
    m = m * 0.93 + lr
  }
  const price = +p.toFixed(2)
  _priceCache.set(stock.code, price)
  return price
}

// 取得昨收（第 299 步）用於計算漲跌
export function getMockPrevPrice(stock) {
  function mulberry32(seed) {
    return () => {
      seed |= 0
      seed = (seed + 0x6d2b79f5) | 0
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }
  function bm(rand) {
    const u1 = Math.max(rand(), 1e-10), u2 = rand()
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
  }
  const rand = mulberry32(seedFromCode(stock.code))
  const vol  = stock.vol ?? 0.018
  let p = stock.price, m = 0
  for (let i = 0; i < 299; i++) {
    const v  = vol * (0.8 + rand() * 0.7)
    const lr = 0.0003 + m * 0.001 + v * bm(rand)
    p = p * Math.exp(lr)
    m = m * 0.93 + lr
  }
  return +p.toFixed(2)
}
