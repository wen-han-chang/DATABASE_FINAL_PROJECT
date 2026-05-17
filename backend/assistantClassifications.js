import { query, withTransaction, sql } from './db.js'

const COMPANY_PROFILE_URL = 'https://openapi.twse.com.tw/v1/opendata/t187ap03_L'
const INDUSTRY_CACHE_HOURS = 24
const INDUSTRY_CODE_NAME = {
  '01': '水泥工業',
  '02': '食品工業',
  '03': '塑膠工業',
  '04': '紡織纖維',
  '05': '電機機械',
  '06': '電器電纜',
  '08': '玻璃陶瓷',
  '09': '造紙工業',
  '10': '鋼鐵工業',
  '11': '橡膠工業',
  '12': '汽車工業',
  '14': '建材營造',
  '15': '航運業',
  '16': '觀光餐旅',
  '17': '金融保險',
  '18': '貿易百貨',
  '20': '其他',
  '21': '化學工業',
  '22': '生技醫療',
  '23': '油電燃氣',
  '24': '半導體業',
  '25': '電腦及週邊設備業',
  '26': '光電業',
  '27': '通信網路業',
  '28': '電子零組件業',
  '29': '電子通路業',
  '30': '資訊服務業',
  '31': '其他電子業',
  '32': '文化創意業',
  '33': '農業科技業',
  '34': '電子商務',
  '35': '綠能環保',
  '36': '數位雲端',
  '37': '運動休閒',
  '38': '居家生活',
}

const TOPIC_DEFINITIONS = [
  {
    code: 'memory',
    name: '記憶體',
    description: '主要與 DRAM、Flash、記憶體晶片或模組相關的公司。',
  },
  {
    code: 'ai_server',
    name: 'AI 伺服器',
    description: '主要與 AI 伺服器、伺服器整機或伺服器 ODM 相關的公司。',
  },
  {
    code: 'cooling',
    name: '散熱',
    description: '主要與散熱模組、風扇或液冷解決方案相關的公司。',
  },
  {
    code: 'pcb',
    name: 'PCB',
    description: '主要與印刷電路板、ABF 載板或高階板材相關的公司。',
  },
  {
    code: 'telecom',
    name: '電信',
    description: '主要電信服務公司。',
  },
  {
    code: 'shipping',
    name: '航運',
    description: '主要航運與貨櫃相關公司。',
  },
  {
    code: 'heavy_electric',
    name: '重電',
    description: '主要與變壓器、電力設備或電網建設相關的公司。',
  },
  {
    code: 'robotics',
    name: '機器人',
    description: '主要與工業機器人、自動化或智慧製造相關的公司。',
  },
  {
    code: 'silicon_photonics',
    name: '矽光子',
    description: '主要與光通訊、高速傳輸或矽光子供應鏈相關的公司。',
  },
]

const TOPIC_MEMBERSHIPS = [
  { topicCode: 'memory', stockCode: '2408', note: '南亞科；DRAM 記憶體。' },
  { topicCode: 'memory', stockCode: '2344', note: '華邦電；記憶體 IC。' },
  { topicCode: 'memory', stockCode: '2337', note: '旺宏；非揮發性記憶體。' },
  { topicCode: 'memory', stockCode: '6770', note: '力積電；具記憶體相關業務。' },
  { topicCode: 'ai_server', stockCode: '2382', note: '廣達；伺服器與 AI 伺服器 ODM。' },
  { topicCode: 'ai_server', stockCode: '2356', note: '英業達；伺服器與 AI 伺服器。' },
  { topicCode: 'ai_server', stockCode: '3231', note: '緯創；伺服器 ODM。' },
  { topicCode: 'ai_server', stockCode: '6669', note: '緯穎；伺服器 ODM。' },
  { topicCode: 'ai_server', stockCode: '2317', note: '鴻海；伺服器供應鏈與系統整合。' },
  { topicCode: 'cooling', stockCode: '3017', note: '奇鋐；散熱模組。' },
  { topicCode: 'cooling', stockCode: '3324', note: '雙鴻；散熱模組。' },
  { topicCode: 'cooling', stockCode: '2421', note: '建準；散熱風扇。' },
  { topicCode: 'pcb', stockCode: '2383', note: '台光電；高階 CCL。' },
  { topicCode: 'pcb', stockCode: '3037', note: '欣興；載板與 PCB。' },
  { topicCode: 'pcb', stockCode: '2368', note: '金像電；伺服器 PCB。' },
  { topicCode: 'telecom', stockCode: '2412', note: '中華電；電信服務。' },
  { topicCode: 'telecom', stockCode: '3045', note: '台灣大；電信服務。' },
  { topicCode: 'telecom', stockCode: '4904', note: '遠傳；電信服務。' },
  { topicCode: 'shipping', stockCode: '2603', note: '長榮；貨櫃航運。' },
  { topicCode: 'shipping', stockCode: '2609', note: '陽明；貨櫃航運。' },
  { topicCode: 'shipping', stockCode: '2615', note: '萬海；貨櫃航運。' },
  { topicCode: 'heavy_electric', stockCode: '1513', note: '中興電；重電設備。' },
  { topicCode: 'heavy_electric', stockCode: '1519', note: '華城；變壓器。' },
  { topicCode: 'heavy_electric', stockCode: '1503', note: '士電；重電設備。' },
  { topicCode: 'robotics', stockCode: '2049', note: '上銀；自動化元件。' },
  { topicCode: 'robotics', stockCode: '1590', note: '亞德客-KY；氣動元件。' },
  { topicCode: 'robotics', stockCode: '2308', note: '台達電；自動化與機器人相關應用。' },
  { topicCode: 'silicon_photonics', stockCode: '3081', note: '聯亞；光通訊磊晶。' },
  { topicCode: 'silicon_photonics', stockCode: '3163', note: '波若威；光通訊。' },
  { topicCode: 'silicon_photonics', stockCode: '2345', note: '智邦；高速網通。' },
]

function uniqueCodes(codes) {
  return [...new Set((codes || []).map((code) => String(code || '').trim()).filter(Boolean))]
}

function pickField(row, keys) {
  for (const key of keys) {
    const value = row?.[key]
    if (value != null && String(value).trim()) return String(value).trim()
  }
  return ''
}

function normalizeIndustryName(value) {
  const text = String(value || '').trim()
  return INDUSTRY_CODE_NAME[text] || text
}

async function ensureTopicSeed() {
  await withTransaction(async (tx) => {
    for (const topic of TOPIC_DEFINITIONS) {
      await new sql.Request(tx)
        .input('topicCode', sql.VarChar(50), topic.code)
        .input('topicName', sql.NVarChar(100), topic.name)
        .input('description', sql.NVarChar(300), topic.description)
        .query(`IF EXISTS (
                  SELECT 1
                  FROM dbo.assistant_topics
                  WHERE topic_code = @topicCode
                )
                  UPDATE dbo.assistant_topics
                     SET topic_name = @topicName,
                         description = @description
                   WHERE topic_code = @topicCode;
                ELSE
                  INSERT INTO dbo.assistant_topics
                    (topic_code, topic_name, description)
                  VALUES
                    (@topicCode, @topicName, @description);`)
    }

    for (const item of TOPIC_MEMBERSHIPS) {
      await new sql.Request(tx)
        .input('topicCode', sql.VarChar(50), item.topicCode)
        .input('stockCode', sql.VarChar(10), item.stockCode)
        .input('note', sql.NVarChar(300), item.note)
        .input('sourceType', sql.NVarChar(50), 'curated')
        .query(`IF EXISTS (
                  SELECT 1
                  FROM dbo.assistant_stock_topics
                  WHERE topic_code = @topicCode
                    AND stock_code = @stockCode
                )
                  UPDATE dbo.assistant_stock_topics
                     SET note = @note,
                         source_type = @sourceType,
                         updated_at = SYSDATETIME()
                   WHERE topic_code = @topicCode
                     AND stock_code = @stockCode;
                ELSE
                  INSERT INTO dbo.assistant_stock_topics
                    (topic_code, stock_code, note, source_type)
                  VALUES
                    (@topicCode, @stockCode, @note, @sourceType);`)
    }
  })
}

async function readIndustries(codes) {
  const safeCodes = uniqueCodes(codes)
  if (!safeCodes.length) return []

  const placeholders = safeCodes.map((_, index) => `@c${index}`).join(', ')
  const params = Object.fromEntries(safeCodes.map((code, index) => [`c${index}`, code]))

  return query(
    `SELECT stock_code AS stockCode,
            stock_name AS stockName,
            industry_name AS industryName,
            source_url AS sourceUrl,
            fetched_at AS fetchedAt
     FROM dbo.assistant_stock_industries
     WHERE stock_code IN (${placeholders})`,
    params,
  )
}

function industriesAreFresh(rows, requestedCodes) {
  if (rows.length !== requestedCodes.length) return false
  return rows.every((row) => {
    const fetchedAt = row.fetchedAt instanceof Date
      ? row.fetchedAt
      : new Date(row.fetchedAt)
    return Date.now() - fetchedAt.getTime() < INDUSTRY_CACHE_HOURS * 60 * 60 * 1000
  })
}

async function fetchCompanyProfiles() {
  const response = await fetch(COMPANY_PROFILE_URL, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'database-final-project/1.0',
    },
    signal: AbortSignal.timeout(20000),
  })

  if (!response.ok) {
    throw new Error(`Company profile HTTP ${response.status}`)
  }

  const rows = await response.json()
  if (!Array.isArray(rows)) return []

  return rows
    .map((row) => ({
      stockCode: pickField(row, ['公司代號', '股票代號', '證券代號', 'Code']),
      stockName: pickField(row, ['公司簡稱', '公司名稱', '證券名稱', 'Name']),
      industryName: normalizeIndustryName(pickField(row, ['產業別', '產業類別', 'Industry'])),
    }))
    .filter((row) => row.stockCode && row.industryName)
}

async function saveIndustries(rows) {
  if (!rows.length) return

  await withTransaction(async (tx) => {
    for (const row of rows) {
      await new sql.Request(tx)
        .input('stockCode', sql.VarChar(10), row.stockCode)
        .input('stockName', sql.NVarChar(100), row.stockName || null)
        .input('industryName', sql.NVarChar(100), row.industryName)
        .input('sourceUrl', sql.NVarChar(500), COMPANY_PROFILE_URL)
        .query(`IF EXISTS (
                  SELECT 1
                  FROM dbo.assistant_stock_industries
                  WHERE stock_code = @stockCode
                )
                  UPDATE dbo.assistant_stock_industries
                     SET stock_name = @stockName,
                         industry_name = @industryName,
                         source_url = @sourceUrl,
                         fetched_at = SYSDATETIME()
                   WHERE stock_code = @stockCode;
                ELSE
                  INSERT INTO dbo.assistant_stock_industries
                    (stock_code, stock_name, industry_name, source_url)
                  VALUES
                    (@stockCode, @stockName, @industryName, @sourceUrl);`)
    }
  })
}

export async function getLatestIndustries(codes) {
  const requestedCodes = uniqueCodes(codes)
  if (!requestedCodes.length) return []

  const cached = await readIndustries(requestedCodes)
  const hasUnnormalizedIndustry = cached.some((row) => /^\d{2}$/.test(String(row.industryName || '').trim()))
  if (!hasUnnormalizedIndustry && industriesAreFresh(cached, requestedCodes)) return cached

  try {
    const freshRows = await fetchCompanyProfiles()
    const requested = new Set(requestedCodes)
    await saveIndustries(freshRows.filter((row) => requested.has(row.stockCode)))
    return readIndustries(requestedCodes)
  } catch (error) {
    console.warn('[assistant] Failed to refresh industry profiles:', error.message)
    return cached
  }
}

export async function getTopicsForStocks(codes) {
  const safeCodes = uniqueCodes(codes)
  if (!safeCodes.length) return []

  await ensureTopicSeed()

  const placeholders = safeCodes.map((_, index) => `@c${index}`).join(', ')
  const params = Object.fromEntries(safeCodes.map((code, index) => [`c${index}`, code]))

  return query(
    `SELECT st.stock_code AS stockCode,
            st.topic_code AS topicCode,
            t.topic_name AS topicName,
            st.note,
            st.source_type AS sourceType
     FROM dbo.assistant_stock_topics st
     JOIN dbo.assistant_topics t ON t.topic_code = st.topic_code
     WHERE st.stock_code IN (${placeholders})
     ORDER BY st.stock_code, st.topic_code`,
    params,
  )
}

export async function getStockCodesForTopics(topicCodes) {
  const safeTopicCodes = [...new Set((topicCodes || [])
    .map((code) => String(code || '').trim())
    .filter(Boolean))]
  if (!safeTopicCodes.length) return []

  await ensureTopicSeed()

  const placeholders = safeTopicCodes.map((_, index) => `@t${index}`).join(', ')
  const params = Object.fromEntries(safeTopicCodes.map((code, index) => [`t${index}`, code]))

  return query(
    `SELECT DISTINCT stock_code AS stockCode
     FROM dbo.assistant_stock_topics
     WHERE topic_code IN (${placeholders})
     ORDER BY stock_code`,
    params,
  )
}

export function normalizeRequestedSectors(filters = []) {
  return [...new Set(filters.map((item) => String(item || '').trim()).filter(Boolean))]
}

export function normalizeRequestedTopics(filters = []) {
  const aliasMap = new Map([
    ['記憶體', 'memory'],
    ['dram', 'memory'],
    ['flash', 'memory'],
    ['ai伺服器', 'ai_server'],
    ['ai server', 'ai_server'],
    ['ai_server', 'ai_server'],
    ['散熱', 'cooling'],
    ['pcb', 'pcb'],
    ['電信', 'telecom'],
    ['航運', 'shipping'],
    ['重電', 'heavy_electric'],
    ['機器人', 'robotics'],
    ['矽光子', 'silicon_photonics'],
  ])
  const allowedTopics = new Set([
    'memory',
    'ai_server',
    'cooling',
    'pcb',
    'telecom',
    'shipping',
    'heavy_electric',
    'robotics',
    'silicon_photonics',
  ])

  return [...new Set(filters
    .map((item) => String(item || '').trim().toLowerCase())
    .map((item) => aliasMap.get(item) || item)
    .filter((item) => allowedTopics.has(item)))]
}
