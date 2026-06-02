import { createStructuredResponse, createTextResponse } from './openaiClient.js'
import { buildAssistantContext } from './assistantData.js'
import {
  normalizeRequestedSectors,
  normalizeRequestedTopics,
} from './assistantClassifications.js'

const OUT_OF_SCOPE_REPLY = '抱歉，這題我沒辦法回答，歡迎詢問我台股相關問題~'
const SUPPORTED_TAIWAN_STOCK_HINTS = [
  /記憶體/i,
  /ai\s*伺服器|ai\s*server/i,
  /金融/,
  /高股息/,
  /散熱|pcb|電信|航運|重電|機器人|矽光子/i,
  /\b00\d{2,4}\b/,
  /\b\d{4}\b/,
]

const GENERIC_STOCK_RECOMMENDATION_HINT = /(股票|個股|台股|臺股|買|投資)/
const SINGLE_STOCK_REQUEST_HINT = /(一個|一檔|一支|一隻|1\s*(?:個|檔|支|隻))/
const DEFAULT_RECOMMENDATION_FACTORS = [
  'technical_strength',
  'dividend_yield',
  'low_pe',
  'low_pb',
]
const STOCK_NAME_ALIASES = [
  ['台積電', '2330'],
  ['鴻海', '2317'],
  ['聯發科', '2454'],
  ['國泰金', '2882'],
  ['富邦金', '2881'],
  ['中信金', '2891'],
  ['兆豐金', '2886'],
  ['玉山金', '2884'],
  ['第一金', '2892'],
  ['中華電', '2412'],
  ['長榮航', '2618'],
  ['長榮', '2603'],
  ['陽明', '2609'],
  ['華航', '2610'],
  ['聯電', '2303'],
  ['台達電', '2308'],
  ['廣達', '2382'],
  ['大立光', '3008'],
  ['華碩', '2357'],
  ['緯創', '3231'],
  ['技嘉', '2376'],
  ['日月光投控', '3711'],
  ['元大台灣50', '0050'],
  ['0050', '0050'],
]

const classifierSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    isTaiwanStockRelated: { type: 'boolean' },
    needsMarketData: { type: 'boolean' },
    needsRecommendation: { type: 'boolean' },
    targetCount: { type: 'integer' },
    symbols: { type: 'array', items: { type: 'string' } },
    etfCodes: { type: 'array', items: { type: 'string' } },
    topicKeywords: { type: 'array', items: { type: 'string' } },
    sectorFilters: { type: 'array', items: { type: 'string' } },
    topicFilters: { type: 'array', items: { type: 'string' } },
    rankingFactors: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'isTaiwanStockRelated',
    'needsMarketData',
    'needsRecommendation',
    'targetCount',
    'symbols',
    'etfCodes',
    'topicKeywords',
    'sectorFilters',
    'topicFilters',
    'rankingFactors',
  ],
}

function compactHoldingsByEtf(holdingsByEtf = {}) {
  return Object.fromEntries(
    Object.entries(holdingsByEtf).map(([code, rows]) => [code, {
      count: rows.length,
      topHoldings: rows.slice(0, 10),
    }]),
  )
}

function compactScreening(screening) {
  if (!screening) return null
  return {
    universeType: screening.universeType,
    universeLabel: screening.universeLabel,
    etfCodes: screening.etfCodes,
    rankingFactors: screening.rankingFactors,
    appliedFilters: screening.appliedFilters,
    targetCount: screening.targetCount,
    totalCandidates: screening.totalCandidates,
    matchedCandidateCount: screening.matchedCandidateCount,
    diversityRule: screening.diversityRule,
    industryConcentration: screening.industryConcentration,
    dataBasis: screening.dataBasis,
    rankedCandidates: (screening.rankedCandidates || []).map((candidate) => ({
      code: candidate.code,
      name: candidate.name,
      rank: candidate.rank,
      score: candidate.score,
      weight: candidate.weight,
      industry: candidate.industry,
      topics: candidate.topics,
      rankingFactors: candidate.rankingFactors,
      rankingFactorWeights: candidate.rankingFactorWeights,
      factorBreakdown: candidate.factorBreakdown,
      technicalReasons: candidate.technicalReasons,
      fundamentals: candidate.fundamentals,
      technicals: candidate.technicals,
      technicalRules: candidate.technicalRules,
      bars: candidate.bars,
      barsMeta: candidate.barsMeta,
    })),
  }
}

function stringifyContext(context) {
  const screeningCodes = new Set(context.screening?.rankedCandidates?.map((candidate) => candidate.code) || [])
  const marketSnapshots = screeningCodes.size
    ? context.marketSnapshots.filter((snapshot) => screeningCodes.has(snapshot.code))
    : context.marketSnapshots
  const fundamentals = screeningCodes.size
    ? (context.fundamentals || []).filter((item) => screeningCodes.has(item.stockCode))
    : (context.fundamentals || [])

  return JSON.stringify({
    stocks: context.stocks,
    holdingsByEtf: compactHoldingsByEtf(context.holdingsByEtf),
    marketSnapshots,
    fundamentals: fundamentals.map((item) => ({
      stockCode: item.stockCode,
      stockName: item.stockName,
      dataDate: item.tradeDate,
      officialReferenceClose: item.rawClosePrice ?? item.closePrice,
      latestValuationPrice: item.valuationPrice ?? item.closePrice,
      adjustedDividendYield: item.dividendYield,
      adjustedPeRatio: item.peRatio,
      adjustedPbRatio: item.pbRatio,
      officialDividendYield: item.rawDividendYield,
      officialPeRatio: item.valuationAvailability?.peRatio?.available ? item.rawPeRatio : null,
      officialPbRatio: item.valuationAvailability?.pbRatio?.available ? item.rawPbRatio : null,
      dividendYear: item.dividendYear,
      financialPeriod: item.financialPeriod,
      adjustedToLatestPrice: Boolean(item.priceAdjusted),
      valuationAvailability: item.valuationAvailability,
    })),
    screening: compactScreening(context.screening),
  }, null, 2)
}

function normalizeClassification(classification, message) {
  const normalized = {
    ...classification,
    symbols: [...new Set(classification.symbols || [])],
    etfCodes: [...new Set(classification.etfCodes || [])],
    rankingFactors: [...new Set(classification.rankingFactors || [])],
    sectorFilters: normalizeRequestedSectors(classification.sectorFilters || []),
    topicFilters: normalizeRequestedTopics(classification.topicFilters || []),
  }

  const detectedEtfCodes = String(message || '').match(/\b00\d{2,4}\b/g) || []
  normalized.etfCodes = [...new Set([...normalized.etfCodes, ...detectedEtfCodes])]
  const detectedNumericSymbols = String(message || '').match(/\b\d{4,6}\b/g) || []
  const detectedAliasSymbols = STOCK_NAME_ALIASES
    .filter(([name]) => String(message || '').includes(name))
    .map(([, code]) => code)

  if (detectedAliasSymbols.length && !detectedNumericSymbols.length) {
    normalized.symbols = [...new Set(detectedAliasSymbols.filter((code) => !/^00/.test(code)))]
    normalized.etfCodes = [...new Set([
      ...normalized.etfCodes,
      ...detectedAliasSymbols.filter((code) => /^00/.test(code)),
    ])]
  } else {
    normalized.symbols = [...new Set([...normalized.symbols, ...detectedNumericSymbols.filter((code) => !/^00/.test(code))])]
  }

  const targetMatch = String(message || '').match(/前\s*(\d+)\s*(?:名|檔)/)
  if (targetMatch) {
    normalized.targetCount = Number(targetMatch[1])
  }

  const recommendationIntent = /(推薦|排行|排名|前\s*\d+\s*(?:名|檔)|挑出|選出|最強|值得買)/.test(message)
  if (recommendationIntent) {
    normalized.needsRecommendation = true
  }

  const shortTermMomentumIntent = /(明天|隔日|短線|當沖|波段|暴漲|噴出|急漲|突破)/.test(message)
  if (recommendationIntent && shortTermMomentumIntent) {
    normalized.rankingFactors = ['technical_strength']
  }

  if (recommendationIntent && GENERIC_STOCK_RECOMMENDATION_HINT.test(message)) {
    normalized.isTaiwanStockRelated = true
    normalized.needsMarketData = true
  }

  if (recommendationIntent && SINGLE_STOCK_REQUEST_HINT.test(message)) {
    normalized.targetCount = 1
  }

  if (/技術面|技術指標|最強/.test(message) && !normalized.rankingFactors.includes('technical_strength')) {
    normalized.rankingFactors.push('technical_strength')
  }

  if (/金融/.test(message) && !normalized.sectorFilters.includes('金融')) {
    normalized.sectorFilters.push('金融')
  }

  if (/記憶體/i.test(message) && !normalized.topicFilters.includes('memory')) {
    normalized.topicFilters.push('memory')
  }

  if (/ai\s*伺服器|ai\s*server/i.test(message) && !normalized.topicFilters.includes('ai_server')) {
    normalized.topicFilters.push('ai_server')
  }

  const topicHints = [
    { pattern: /散熱/i, code: 'cooling' },
    { pattern: /\bpcb\b/i, code: 'pcb' },
    { pattern: /電信/i, code: 'telecom' },
    { pattern: /航運/i, code: 'shipping' },
    { pattern: /重電/i, code: 'heavy_electric' },
    { pattern: /機器人/i, code: 'robotics' },
    { pattern: /矽光子/i, code: 'silicon_photonics' },
  ]
  for (const { pattern, code } of topicHints) {
    if (pattern.test(message) && !normalized.topicFilters.includes(code)) {
      normalized.topicFilters.push(code)
    }
  }

  if (/高股息/.test(message) && !normalized.rankingFactors.includes('dividend_yield')) {
    normalized.rankingFactors.push('dividend_yield')
  }

  const wantsOverallRecommendation = /(最值得買|推薦|值得買|首選)/.test(message)
  const hasExplicitRankingFactor = /(技術面|技術指標|殖利率|本益比|股價淨值比|權重)/.test(message)
  if (wantsOverallRecommendation && !hasExplicitRankingFactor && !shortTermMomentumIntent) {
    normalized.rankingFactors = DEFAULT_RECOMMENDATION_FACTORS
  }

  if (
    recommendationIntent
    && GENERIC_STOCK_RECOMMENDATION_HINT.test(message)
    && !hasExplicitRankingFactor
    && !shortTermMomentumIntent
  ) {
    normalized.rankingFactors = DEFAULT_RECOMMENDATION_FACTORS
  }

  if (SUPPORTED_TAIWAN_STOCK_HINTS.some((pattern) => pattern.test(message))) {
    normalized.isTaiwanStockRelated = true
    normalized.needsMarketData = true
  }

  if (!Number.isInteger(normalized.targetCount) || normalized.targetCount <= 0) {
    normalized.targetCount = 5
  }

  return normalized
}

function summarizeContext(context) {
  return {
    stockCount: context.stocks.length,
    etfCount: Object.keys(context.holdingsByEtf).length,
    marketSnapshotCount: context.marketSnapshots.length,
    technicalSnapshotCount: context.marketSnapshots.filter((item) => item.technicals).length,
    fundamentalCount: context.fundamentals?.length || 0,
  }
}

function buildEvidence(context) {
  const requestedCodeSet = new Set(context.requestedCodes || [])
  const technicalEvidence = context.marketSnapshots
    .filter((snapshot) => snapshot.technicals)
    .map((snapshot) => ({
      kind: 'technical',
      code: snapshot.code,
      asOfDate: snapshot.technicals.asOfDate,
      close: snapshot.technicals.close,
      movingAverages: snapshot.technicals.movingAverages,
      kd: snapshot.technicals.kd,
      rsi: snapshot.technicals.rsi,
      macd: snapshot.technicals.macd,
      bollinger: snapshot.technicals.bollinger,
      technicalRules: snapshot.technicalRules || null,
    }))

  const fundamentalEvidence = (context.fundamentals || [])
    .filter((item) => !requestedCodeSet.size || requestedCodeSet.has(item.stockCode))
    .map((item) => ({
      kind: 'fundamentals',
      code: item.stockCode,
      name: item.stockName,
      tradeDate: item.tradeDate,
      closePrice: item.closePrice,
      dividendYield: item.dividendYield,
      dividendYear: item.dividendYear,
      peRatio: item.peRatio,
      pbRatio: item.pbRatio,
      rawClosePrice: item.rawClosePrice,
      rawDividendYield: item.rawDividendYield,
      rawPeRatio: item.rawPeRatio,
      rawPbRatio: item.rawPbRatio,
      valuationPrice: item.valuationPrice,
      valuationPriceSource: item.valuationPriceSource,
      valuationPriceDate: item.valuationPriceDate,
      valuationPriceTime: item.valuationPriceTime,
      priceAdjusted: item.priceAdjusted,
      financialPeriod: item.financialPeriod,
      financialPeriodNote: 'TWSE BWIBBU_d 財務期間欄位，代表估值資料採用的財務資料期間，不是完整季報內容。',
      valuationAvailability: item.valuationAvailability,
      source: item.sourceUrl,
    }))

  const screeningEvidence = context.screening?.rankedCandidates?.map((candidate) => ({
    kind: 'screening',
    universeType: context.screening.universeType,
    universeLabel: context.screening.universeLabel,
    code: candidate.code,
    name: candidate.name,
    rank: candidate.rank,
    score: candidate.score,
    rankingFactors: candidate.rankingFactors,
    rankingFactorWeights: candidate.rankingFactorWeights,
    factorBreakdown: candidate.factorBreakdown,
    weight: candidate.weight,
    industry: candidate.industry,
    topics: candidate.topics,
    technicalReasons: candidate.technicalReasons,
    fundamentals: candidate.fundamentals,
    dataBasis: context.screening.dataBasis,
    diversityRule: context.screening.diversityRule,
    industryConcentration: context.screening.industryConcentration,
  })) || []

  if (screeningEvidence.length) return screeningEvidence

  const technicalByCode = new Map(technicalEvidence.map((item) => [item.code, item]))
  const fundamentalByCode = new Map(fundamentalEvidence.map((item) => [item.code, item]))
  const analysisCodes = [...new Set([...technicalByCode.keys(), ...fundamentalByCode.keys()])]

  return analysisCodes.map((code) => {
    const technical = technicalByCode.get(code) || null
    const fundamentals = fundamentalByCode.get(code) || null
    return {
      kind: 'stock_analysis',
      code,
      name: fundamentals?.name || '',
      asOfDate: technical?.asOfDate || fundamentals?.tradeDate || null,
      close: technical?.close ?? fundamentals?.valuationPrice ?? fundamentals?.closePrice ?? null,
      technical,
      fundamentals,
    }
  })
}

export async function answerStockQuestion(message) {
  const cleanMessage = String(message || '').trim()
  if (!cleanMessage) {
    const error = new Error('問題不可為空。')
    error.statusCode = 400
    throw error
  }

  const rawClassification = await createStructuredResponse({
    name: 'stock_question_classification',
    schema: classifierSchema,
    instructions: [
      '你是台股助理的路由分類器。',
      '請只判斷使用者問題是否與台灣上市上櫃股票、台灣 ETF、台股交易、台股財報、台股股價、台股技術分析、台股產業與台股投資研究直接相關。',
      '若問題不是台股題，isTaiwanStockRelated 必須為 false。',
      '若問題只提到美股、其他國家股市、一般總經、一般理財、或沒有明確指向台股，isTaiwanStockRelated 也必須為 false。',
      'symbols 只放明確出現的股票代碼，例如 2330。',
      'etfCodes 只放明確出現的 ETF 代碼，例如 0050。',
      'topicKeywords 放使用者想篩選的主題詞，例如 記憶體、半導體、高股息。',
      'sectorFilters 只放正式產業條件，例如 金融、半導體、航運。',
      'topicFilters 只放已支援的題材條件；目前可填 memory、ai_server、cooling、pcb、telecom、shipping、heavy_electric、robotics、silicon_photonics。金融是正式產業，必須放進 sectorFilters，不可放 finance topic。',
      '若使用者要求排名、推薦、前幾名，needsRecommendation 必須為 true，targetCount 盡量取出明確數字，沒有就填 5。',
      'rankingFactors 只能從 technical_strength、dividend_yield、low_pe、low_pb、etf_weight 中挑選；若使用者沒有指定但有推薦需求，預設放 technical_strength。',
    ].join('\n'),
    userInput: cleanMessage,
  })
  const classification = normalizeClassification(rawClassification, cleanMessage)

  if (!classification.isTaiwanStockRelated) {
    return {
      reply: OUT_OF_SCOPE_REPLY,
      classification,
      contextSummary: null,
      sources: [],
    }
  }

  const context = await buildAssistantContext(classification)
  const reply = await createTextResponse({
    instructions: [
      '你是台股投資研究助理，回答必須使用繁體中文。',
      '你只能根據我提供的 context 做出任何和個股、ETF、價格、成分股、報酬或推薦有關的敘述。',
      '若 context.marketSnapshots[].technicals 有資料，請把它視為和圖表一致的技術分析依據；可以引用 MA、KD、RSI、MACD、Bollinger 的值與 signal。',
      '如果使用者問「怎麼看圖」、「技術面」、「目前走勢」、「KD」、「RSI」、「MACD」、「布林通道」、「均線」等問題，請優先使用 technicals 作答。',
      '若 context.marketSnapshots[].technicalRules 有資料，請優先使用 technicalRules.signals 與 technicalRules.scoring 說明技術面；technicalRules 是後端 deterministic rule engine 的結果，可信度高於自行推測。',
      '請不要自行發明 technicalRules.signals.patterns.detected 沒有出現的型態；若 technicalRules.available 為 false，請說明技術規則資料不足。',
      '若 context.screening 有資料，代表系統已根據可量化條件完成候選股排序。使用者要求前幾名或推薦時，請優先使用 context.screening.rankedCandidates，逐一用一般投資人聽得懂的語言說明入選原因。',
      '回答中不得提到 context、screening、rankedCandidates、rankingFactors、technicalScore、technicalReasons 這些程式或欄位名稱；請改說「本次依據」、「綜合評估」、「技術面」、「估值」、「殖利率」等自然語言。',
      '若排序同時使用 technical_strength、dividend_yield、low_pe、low_pb，請把它稱為「綜合評估」，不要說成純技術面排名。',
      '若 context.screening.universeLabel 有資料，請明確說本次篩選範圍，例如「0050 成分股」，不要只說 ETF 成分股。',
      '若 context.screening.rankedCandidates[].factorBreakdown 有資料，推薦每檔股票時請簡短列出各因子的明確排名，例如「技術面第 3/50、殖利率第 8/45、低 PE 第 5/42、低 PB 第 7/50」，不要只寫前段、中上或只給總分。',
      '若某個 factorBreakdown 的 available 為 false，代表該因子資料不足；請說該因子資料不足，不可把它說成低 PE、低 PB、殖利率或技術面的優勢。',
      '若 fundamentals.valuationAvailability.peRatio.available 為 false，請說 TWSE BWIBBU_d 未提供有效本益比，系統目前未接 EPS/季報資料源所以不自行重算；不可說 PE 為 0，也不可把 PE 無值解讀成便宜。',
      '若 context.screening.dataBasis 有資料，回答中請用一句話交代資料依據；若基本面已重新估算，說明是 TWSE BWIBBU_d 估值欄位搭配最新報價重算。',
      '若 context.screening.industryConcentration.hasConcentration 為 true，請在風險段落提醒推薦名單有產業集中現象；若 diversityRule.enabled 為 true，也請說明系統已先套用同產業分散規則。',
      '若 context.screening.appliedFilters 有資料，回答時先用自然語言說明本次篩選條件，再說明排序結果。',
      '如果 context.screening 顯示已找到候選股，但技術面資料暫時不足，請直接說明是系統尚未成功取得足夠歷史資料，不要把責任推給使用者，也不要要求使用者自行提供資料。',
      '如果使用者要求的條件無法由 rankingFactors 或 context 中的欄位支援，例如沒有可驗證的主題分類，請明確說明目前資料不足，不可自行臆測分類。',
      '若 classification.needsMarketData 為 false，且問題只是一般投資概念，你可以用一般金融知識回答。',
      '如果 context 不足以支持使用者要求，請直接說明目前資料不足，指出缺少什麼，不可自行補編。',
      '若使用者要求推薦，第一段先用簡短結論開頭，再補篩選範圍、資料依據與理由；不要輸出「1 到 2 句」、「1–2 句」、「1 到 2 行」、「1–2 行」、「每檔說明 1–2 行」或類似提示文字。如果不是 ETF 問題，不要主動提 ETF 權重。',
      '推薦回答請用「研究名單」、「優先觀察」等措辭，不要寫成保證或直接下單指令；不要主動提供「買入價格區間」，若需要價位請改說支撐、壓力與觀察條件。',
      '不要回答台股以外的問題。',
      '回答最後加上一句：以上為資料整理與研究輔助，非投資建議。',
    ].join('\n'),
    userInput: [
      `使用者問題：${cleanMessage}`,
      `分類結果：${JSON.stringify(classification)}`,
      '若 context.fundamentals 有資料，請直接用自然語言引用殖利率、本益比、股價淨值比；不要說缺少 EPS、BVPS 或股利所以無法回答。若資料已用最新價校正，請說「以 TWSE 原始估值資料搭配最新報價重新估算」，可以說明原始基準價與最新估算價，但不要輸出 rawClosePrice、rawDividendYield、rawPeRatio、rawPbRatio、valuationPrice、priceAdjusted、fetchedAt、sourceUrl 這些內部欄位名稱。',
      'financialPeriod 是 TWSE BWIBBU_d 的財務期間欄位，只代表估值指標採用的財務資料期間，不等於完整季報。回答時不要說「只能抓到某月財報」；若使用者要求完整季度財報、營收、EPS 明細、資產負債表或損益表，請說目前此功能尚未接 MOPS 季報資料源。',
      `context：${stringifyContext(context)}`,
    ].join('\n\n'),
  })

  return {
    reply,
    classification,
    contextSummary: summarizeContext(context),
    sources: context.sources,
    evidence: buildEvidence(context),
  }
}
