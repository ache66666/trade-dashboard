'use strict';

const ANALYSIS_ERROR_CODES = Object.freeze({
  CONFIGURATION:'ANALYSIS_NOT_CONFIGURED',
  TIMEOUT:'ANALYSIS_TIMEOUT',
  PROVIDER:'ANALYSIS_PROVIDER_FAILED',
  INVALID_RESPONSE:'ANALYSIS_INVALID_RESPONSE'
});
const DIRECTIONS = Object.freeze(['up', 'down', 'flat', 'unknown']);
const COLLECTIONS = Object.freeze([
  'rates',
  'fx',
  'equities',
  'commodities',
  'credit',
  'events',
  'risks',
  'trade_ideas',
  'uncertain_items'
]);
const PROMPT_VERSION = 'morning-meeting-v1';
const ANALYSIS_LIMITS = Object.freeze({
  maxFiles:4,
  maxTotalBytes:20 * 1024 * 1024
});

function analysisError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function marketItemSchema() {
  return {
    type:'object',
    additionalProperties:false,
    required:['name', 'value', 'unit', 'change', 'direction', 'comment', 'source_text', 'confidence'],
    properties:{
      name:{ type:'string' },
      value:{ type:['number', 'null'] },
      unit:{ type:['string', 'null'] },
      change:{ type:['number', 'string', 'null'] },
      direction:{ type:'string', enum:DIRECTIONS },
      comment:{ type:'string' },
      source_text:{ type:'string' },
      confidence:{ type:'number', minimum:0, maximum:1 }
    }
  };
}

function structuredDataSchema() {
  const properties = {
    meeting_date:{ type:['string', 'null'] },
    title:{ type:'string' },
    source:{ type:'string' },
    market_summary:{ type:'string' }
  };
  COLLECTIONS.forEach(name => {
    properties[name] = { type:'array', maxItems:100, items:marketItemSchema() };
  });
  return {
    type:'object',
    additionalProperties:false,
    required:['meeting_date', 'title', 'source', 'market_summary'].concat(COLLECTIONS),
    properties
  };
}

function outputSchema() {
  return {
    type:'object',
    additionalProperties:false,
    required:['extracted_text', 'structured_data', 'analysis_text'],
    properties:{
      extracted_text:{ type:'string' },
      structured_data:structuredDataSchema(),
      analysis_text:{ type:'string' }
    }
  };
}

function stripMarkdownFence(value) {
  const text = String(value || '').trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
  return match ? match[1].trim() : text;
}

function responseText(payload) {
  if (typeof payload.output_text === 'string') return payload.output_text;
  if (!Array.isArray(payload.output)) return '';
  for (const item of payload.output) {
    if (!item || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      if (content && content.type === 'output_text' && typeof content.text === 'string') return content.text;
    }
  }
  return '';
}

function validDateOrNull(value) {
  if (value === null) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validMarketItem(item) {
  const keys = ['name', 'value', 'unit', 'change', 'direction', 'comment', 'source_text', 'confidence'];
  if (!item || typeof item !== 'object' || Array.isArray(item)) return false;
  if (Object.keys(item).sort().join('|') !== keys.sort().join('|')) return false;
  if (typeof item.name !== 'string' || typeof item.comment !== 'string' || typeof item.source_text !== 'string') return false;
  if (item.value !== null && !Number.isFinite(item.value)) return false;
  if (item.unit !== null && typeof item.unit !== 'string') return false;
  if (item.change !== null && typeof item.change !== 'string' && !Number.isFinite(item.change)) return false;
  return DIRECTIONS.includes(item.direction) && Number.isFinite(item.confidence) &&
    item.confidence >= 0 && item.confidence <= 1;
}

function validateStructuredOutput(value) {
  const data = value && value.structured_data;
  const rootKeys = ['analysis_text', 'extracted_text', 'structured_data'];
  const dataKeys = ['meeting_date', 'title', 'source', 'market_summary'].concat(COLLECTIONS);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (Object.keys(value).sort().join('|') !== rootKeys.sort().join('|')) return false;
  if (typeof value.extracted_text !== 'string' || typeof value.analysis_text !== 'string') return false;
  if (value.extracted_text.length > 200000 || value.analysis_text.length > 100000) return false;
  if (!data || typeof data !== 'object' || Array.isArray(data) || !validDateOrNull(data.meeting_date)) return false;
  if (Object.keys(data).sort().join('|') !== dataKeys.sort().join('|')) return false;
  if (typeof data.title !== 'string' || typeof data.source !== 'string' || typeof data.market_summary !== 'string') return false;
  if (!COLLECTIONS.every(name => Array.isArray(data[name]) && data[name].length <= 100 && data[name].every(validMarketItem))) return false;
  return [
    '1. 今日市场在交易什么',
    '2. 国内利率与资金面',
    '3. 海外利率与汇率',
    '4. 股票、商品与风险偏好',
    '5. 关键事件和催化剂',
    '6. 数据支持的结论',
    '7. 尚未得到验证的判断',
    '8. 今日继续观察的问题'
  ].every(heading => value.analysis_text.includes(heading));
}

function parseStructuredOutput(payload) {
  let parsed;
  try {
    parsed = JSON.parse(stripMarkdownFence(responseText(payload)));
  } catch (error) {
    throw analysisError(ANALYSIS_ERROR_CODES.INVALID_RESPONSE, 'Model response was not valid JSON');
  }
  if (!validateStructuredOutput(parsed)) {
    throw analysisError(ANALYSIS_ERROR_CODES.INVALID_RESPONSE, 'Model response did not match the required schema');
  }
  return parsed;
}

function promptText(meeting) {
  return [
    '你是严谨的市场晨会材料分析助手。只使用图片中明确出现的信息，不得编造数值或日期。',
    '无法识别的值使用 null；推断与原文事实必须分开；低置信度内容放入 uncertain_items。',
    '每个数据项保留 source_text 供人工核对，confidence 必须在 0 到 1。',
    'analysis_text 必须使用中文并严格包含以下八个编号标题：',
    '1. 今日市场在交易什么',
    '2. 国内利率与资金面',
    '3. 海外利率与汇率',
    '4. 股票、商品与风险偏好',
    '5. 关键事件和催化剂',
    '6. 数据支持的结论',
    '7. 尚未得到验证的判断',
    '8. 今日继续观察的问题',
    `用户记录日期仅供上下文参考，不得据此猜测图片日期：${meeting.meeting_date}.`
  ].join('\n');
}

function createMorningAnalysisService(options) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const apiKey = String(options.apiKey || '').trim();
  const model = String(options.model || 'gpt-5.4-mini').trim();
  const promptVersion = String(options.promptVersion || PROMPT_VERSION).trim();
  const timeoutMs = Number(options.timeoutMs) || 45000;

  async function analyze(meeting, images) {
    let controller;
    let timer;
    let response;
    let payload;
    const content = [{ type:'input_text', text:promptText(meeting) }];

    if (!apiKey || typeof fetchImpl !== 'function') {
      throw analysisError(ANALYSIS_ERROR_CODES.CONFIGURATION, 'Analysis service is not configured');
    }
    images.forEach(image => {
      content.push({
        type:'input_image',
        image_url:`data:${image.mime_type};base64,${image.bytes.toString('base64')}`,
        detail:'high'
      });
    });
    controller = new AbortController();
    timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      response = await fetchImpl('https://api.openai.com/v1/responses', {
        method:'POST',
        headers:{
          Authorization:`Bearer ${apiKey}`,
          'Content-Type':'application/json'
        },
        body:JSON.stringify({
          model,
          store:false,
          input:[{ role:'user', content }],
          text:{
            format:{
              type:'json_schema',
              name:'morning_meeting_analysis',
              strict:true,
              schema:outputSchema()
            }
          },
          max_output_tokens:5000
        }),
        signal:controller.signal
      });
    } catch (error) {
      if (error && (error.name === 'AbortError' || controller.signal.aborted)) {
        throw analysisError(ANALYSIS_ERROR_CODES.TIMEOUT, 'Analysis request timed out');
      }
      throw analysisError(ANALYSIS_ERROR_CODES.PROVIDER, 'Analysis provider unavailable');
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) throw analysisError(ANALYSIS_ERROR_CODES.PROVIDER, 'Analysis provider unavailable');
    try {
      payload = await response.json();
    } catch (error) {
      throw analysisError(ANALYSIS_ERROR_CODES.INVALID_RESPONSE, 'Model response was not valid JSON');
    }
    return {
      ...parseStructuredOutput(payload),
      model_provider:'openai',
      model_name:model,
      prompt_version:promptVersion
    };
  }

  return Object.freeze({ analyze });
}

module.exports = {
  ANALYSIS_ERROR_CODES,
  ANALYSIS_LIMITS,
  COLLECTIONS,
  DIRECTIONS,
  PROMPT_VERSION,
  createMorningAnalysisService,
  outputSchema,
  parseStructuredOutput,
  stripMarkdownFence,
  validateStructuredOutput
};
