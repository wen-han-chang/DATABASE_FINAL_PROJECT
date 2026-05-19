export function scoreTechnicalRules(result) {
  let trendScore = 0
  let momentumScore = 0
  let volumeScore = 0
  let patternScore = 0
  let riskPenalty = 0
  const reasons = []

  if (result.movingAverage?.structure === 'bullish_alignment') {
    trendScore += 25
    reasons.push('均線多頭排列')
  } else if (result.movingAverage?.structure === 'bearish_alignment') {
    riskPenalty -= 10
    reasons.push('均線空頭排列')
  }
  if (result.movingAverage?.slopes?.ma20 === 'up') {
    trendScore += 5
    reasons.push('MA20 上彎')
  }
  if (result.movingAverage?.slopes?.ma60 === 'up') {
    trendScore += 5
    reasons.push('MA60 上彎')
  }
  if (result.movingAverage?.crosses?.includes('ma5_cross_above_ma20')) {
    trendScore += 5
    reasons.push('MA5 上穿 MA20')
  }
  if (result.movingAverage?.crosses?.includes('ma5_cross_below_ma20')) {
    riskPenalty -= 5
    reasons.push('MA5 下穿 MA20')
  }

  if (result.granville?.matchedRules?.some((rule) => rule.side === 'buy')) {
    trendScore += 5
    reasons.push('出現葛蘭碧偏多訊號')
  }
  if (result.granville?.matchedRules?.some((rule) => rule.side === 'sell')) {
    riskPenalty -= 5
    reasons.push('出現葛蘭碧偏空或過熱訊號')
  }

  if (result.momentum?.macdStatus === 'bullish_momentum_expanding') {
    momentumScore += 15
    reasons.push('MACD 多方動能增強')
  }
  if (result.momentum?.macdStatus === 'bearish_momentum_expanding') {
    riskPenalty -= 6
    reasons.push('MACD 空方動能增強')
  }
  if (result.momentum?.rsiStatus === 'strong_not_overheated') {
    momentumScore += 10
    reasons.push('RSI 偏強但未過熱')
  }
  if (result.momentum?.kdSignals?.includes('kd_golden_cross')) {
    momentumScore += 5
    reasons.push('KD 黃金交叉')
  }
  if (result.momentum?.kdSignals?.includes('kd_death_cross')) {
    riskPenalty -= 4
    reasons.push('KD 死亡交叉')
  }

  if (result.volumePrice?.status === 'price_up_volume_up') {
    volumeScore += 10
    reasons.push('價漲量增')
  }
  if (result.volumePrice?.status === 'breakout_with_volume') {
    volumeScore += 15
    reasons.push('放量突破')
  }
  if (['price_down_volume_up', 'breakdown_with_volume', 'false_breakout'].includes(result.volumePrice?.status)) {
    riskPenalty -= 5
    reasons.push(result.volumePrice.summary)
  }

  const confirmedPatterns = result.patterns?.detected?.filter((item) => item.confirmed) || []
  const bullishPatterns = confirmedPatterns.filter((item) => (
    ['box_breakout_up', 'double_bottom_confirmed', 'inverse_head_and_shoulders'].includes(item.name)
  ))
  const bearishPatterns = confirmedPatterns.filter((item) => (
    ['box_breakdown_down', 'double_top_confirmed', 'head_and_shoulders_top'].includes(item.name)
  ))
  if (bullishPatterns.length) {
    patternScore += 10
    reasons.push(`出現 ${bullishPatterns.map((item) => item.name).join('、')} 型態`)
  }
  if (bearishPatterns.length) {
    riskPenalty -= 8
    reasons.push(`出現 ${bearishPatterns.map((item) => item.name).join('、')} 風險型態`)
  }

  if (result.supportResistance?.nearResistance) {
    riskPenalty -= 5
    reasons.push('接近短期壓力區')
  }
  if (result.momentum?.rsiStatus === 'overheated') {
    riskPenalty -= 5
    reasons.push('RSI 過熱')
  }
  if (result.volatility?.status === 'downside_volatility_breakout') {
    riskPenalty -= 6
    reasons.push('向下波動突破')
  }

  trendScore = Math.min(35, trendScore)
  momentumScore = Math.min(25, momentumScore)
  volumeScore = Math.min(15, volumeScore)
  patternScore = Math.min(15, patternScore)
  riskPenalty = Math.max(-20, riskPenalty)

  const totalScore = Math.max(
    0,
    Math.min(100, trendScore + momentumScore + volumeScore + patternScore + riskPenalty),
  )
  let bias = 'neutral'
  if (totalScore >= 70) bias = 'bullish'
  else if (totalScore <= 35) bias = 'bearish'

  let confidence = 'low'
  if (totalScore >= 75 || totalScore <= 25) confidence = 'high'
  else if (totalScore >= 60 || totalScore <= 40) confidence = 'medium'

  return {
    trendScore,
    momentumScore,
    volumeScore,
    patternScore,
    riskPenalty,
    totalScore,
    bias,
    confidence,
    reasons,
    summary: buildScoreSummary(bias, confidence, reasons),
  }
}

function buildScoreSummary(bias, confidence, reasons) {
  const biasText = {
    bullish: '偏多',
    bearish: '偏空',
    neutral: '中性',
  }[bias] || '中性'
  const confidenceText = {
    high: '可信度較高',
    medium: '可信度中等',
    low: '可信度較低',
  }[confidence] || '可信度較低'
  const reasonText = reasons.slice(0, 4).join('、') || '訊號不明顯'
  return `技術面整體${biasText}，${confidenceText}；主要依據：${reasonText}。`
}
