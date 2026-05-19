import { summarizeTechnicalIndicators } from '../technicalIndicators.js'
import { analyzeGranvilleRules } from './granvilleRules.js'
import { analyzeMovingAverageRules } from './movingAverageRules.js'
import { analyzeMomentumRules } from './momentumRules.js'
import { analyzeVolumePriceRules } from './volumePriceRules.js'
import { analyzeSupportResistanceRules } from './supportResistanceRules.js'
import { analyzeVolatilityRules } from './volatilityRules.js'
import { analyzePatternRules } from './patternRules.js'
import { scoreTechnicalRules } from './technicalScoring.js'
import { safeBars } from './ruleUtils.js'

export function analyzeTechnicalRules(bars) {
  const cleanBars = safeBars(bars)
  if (cleanBars.length < 20) {
    return {
      available: false,
      reason: '技術分析資料不足，至少需要 20 根日 K。',
      sampleSize: cleanBars.length,
    }
  }

  const indicators = summarizeTechnicalIndicators(cleanBars)
  const granville = analyzeGranvilleRules(cleanBars, indicators)
  const movingAverage = analyzeMovingAverageRules(cleanBars, indicators)
  const momentum = analyzeMomentumRules(cleanBars, indicators)
  const volumePrice = analyzeVolumePriceRules(cleanBars, indicators)
  const supportResistance = analyzeSupportResistanceRules(cleanBars, indicators)
  const volatility = analyzeVolatilityRules(cleanBars, indicators)
  const patterns = analyzePatternRules(cleanBars, indicators)

  const signals = {
    granville,
    movingAverage,
    momentum,
    volumePrice,
    supportResistance,
    volatility,
    patterns,
  }
  const scoring = scoreTechnicalRules(signals)
  const latest = cleanBars[cleanBars.length - 1]

  return {
    available: true,
    asOfDate: latest.date,
    close: latest.close,
    sampleSize: cleanBars.length,
    indicators,
    signals,
    scoring,
  }
}
