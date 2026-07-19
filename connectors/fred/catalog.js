'use strict';

const INDICATORS = Object.freeze({
  US2Y:Object.freeze({
    indicatorCode:'US2Y',
    category:'利率',
    seriesId:'DGS2',
    source:'FRED · DGS2',
    unit:'%',
    databaseUnit:'%',
    frequency:'Daily Close',
    changeType:'bp',
    minimum:-5,
    maximum:30,
    scale:1
  }),
  US10Y:Object.freeze({
    indicatorCode:'US10Y',
    category:'利率',
    seriesId:'DGS10',
    source:'FRED · DGS10',
    unit:'%',
    databaseUnit:'%',
    frequency:'Daily Close',
    changeType:'bp',
    minimum:-5,
    maximum:30,
    scale:1
  }),
  USDCNY:Object.freeze({
    indicatorCode:'USDCNY',
    category:'外汇',
    seriesId:'DEXCHUS',
    source:'FRED · DEXCHUS',
    unit:'CNY per USD',
    databaseUnit:'',
    frequency:'Daily',
    changeType:'percent',
    minimum:1,
    maximum:20,
    scale:1
  }),
  WTI:Object.freeze({
    indicatorCode:'WTI',
    category:'商品',
    seriesId:'DCOILWTICO',
    source:'FRED · DCOILWTICO',
    unit:'USD/bbl',
    databaseUnit:'美元/桶',
    frequency:'Daily',
    changeType:'percent',
    minimum:-200,
    maximum:500,
    scale:1
  })
});

const ALLOW_LIST = Object.freeze(Object.keys(INDICATORS));
const DEFAULT_SYMBOLS = Object.freeze(['US10Y', 'USDCNY', 'WTI']);

function getIndicatorDefinition(indicatorCode) {
  const definition = INDICATORS[String(indicatorCode || '').trim().toUpperCase()];
  if (!definition) {
    const error = new Error('Indicator is not in the FRED MVP catalog.');
    error.code = 'CATALOG_INDICATOR_NOT_FOUND';
    throw error;
  }
  return definition;
}

module.exports = { ALLOW_LIST, DEFAULT_SYMBOLS, INDICATORS, getIndicatorDefinition };
