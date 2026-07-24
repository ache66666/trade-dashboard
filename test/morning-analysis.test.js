'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  ANALYSIS_ERROR_CODES,
  COLLECTIONS,
  createMorningAnalysisService,
  outputSchema,
  parseStructuredOutput
} = require('../morning-analysis');

function structuredData() {
  const data = {
    meeting_date:null,
    title:'Morning meeting',
    source:'Uploaded screenshots',
    market_summary:'Liquidity remains the main fact.',
    rates:[],
    fx:[],
    equities:[],
    commodities:[],
    credit:[],
    events:[],
    risks:[],
    trade_ideas:[],
    uncertain_items:[]
  };
  data.rates.push({
    name:'US10Y',
    value:4.2,
    unit:'%',
    change:null,
    direction:'unknown',
    comment:'Shown in source.',
    source_text:'US10Y 4.2%',
    confidence:0.9
  });
  return data;
}

function result() {
  return {
    extracted_text:'US10Y 4.2%',
    structured_data:structuredData(),
    analysis_text:'1. 今日市场在交易什么\n事实。\n2. 国内利率与资金面\n无法确认。\n3. 海外利率与汇率\n事实。\n4. 股票、商品与风险偏好\n无法确认。\n5. 关键事件和催化剂\n无法确认。\n6. 数据支持的结论\n事实。\n7. 尚未得到验证的判断\n无。\n8. 今日继续观察的问题\n继续核对。'
  };
}

function response(status, payload) {
  return {
    ok:status >= 200 && status < 300,
    status,
    json:async function () { return payload; }
  };
}

test('analysis schema contains the fixed market collections and source evidence fields', () => {
  const schema = outputSchema();
  assert.deepEqual(schema.required, ['extracted_text', 'structured_data', 'analysis_text']);
  for (const name of COLLECTIONS) {
    assert.ok(schema.properties.structured_data.properties[name]);
  }
  const item = schema.properties.structured_data.properties.rates.items;
  assert.deepEqual(item.properties.direction.enum, ['up', 'down', 'flat', 'unknown']);
  assert.equal(item.properties.confidence.minimum, 0);
  assert.equal(item.properties.confidence.maximum, 1);
  assert.ok(item.properties.source_text);
});

test('analysis accepts strict JSON and Markdown-wrapped JSON', () => {
  const plain = JSON.stringify(result());
  assert.deepEqual(parseStructuredOutput({ output_text:plain }), result());
  assert.deepEqual(parseStructuredOutput({
    output:[{ content:[{ type:'output_text', text:`\`\`\`json\n${plain}\n\`\`\`` }] }]
  }), result());
});

test('analysis rejects invalid JSON and out-of-range confidence', () => {
  assert.throws(
    () => parseStructuredOutput({ output_text:'not-json' }),
    error => error.code === ANALYSIS_ERROR_CODES.INVALID_RESPONSE
  );
  const invalid = result();
  invalid.structured_data.rates[0].confidence = 2;
  assert.throws(
    () => parseStructuredOutput({ output_text:JSON.stringify(invalid) }),
    error => error.code === ANALYSIS_ERROR_CODES.INVALID_RESPONSE
  );
  const extra = result();
  extra.structured_data.rates[0].invented = true;
  assert.throws(
    () => parseStructuredOutput({ output_text:JSON.stringify(extra) }),
    error => error.code === ANALYSIS_ERROR_CODES.INVALID_RESPONSE
  );
});

test('model client sends images and strict schema without storing the provider response', async () => {
  let request;
  const service = createMorningAnalysisService({
    apiKey:'test-key',
    model:'gpt-test',
    fetchImpl:async function (url, options) {
      request = { url, options, body:JSON.parse(options.body) };
      return response(200, { output_text:JSON.stringify(result()) });
    }
  });
  const output = await service.analyze(
    { meeting_date:'2026-07-24' },
    [{ mime_type:'image/png', bytes:Buffer.from([137,80,78,71]) }]
  );
  assert.equal(request.url, 'https://api.openai.com/v1/responses');
  assert.equal(request.body.store, false);
  assert.equal(request.body.text.format.type, 'json_schema');
  assert.equal(request.body.text.format.strict, true);
  assert.match(request.body.input[0].content[1].image_url, /^data:image\/png;base64,/);
  assert.equal(output.model_provider, 'openai');
  assert.equal(output.model_name, 'gpt-test');
  assert.doesNotMatch(JSON.stringify(request.body), /test-key/);
});

test('missing model configuration fails lazily without network access', async () => {
  let calls = 0;
  const service = createMorningAnalysisService({
    apiKey:'',
    fetchImpl:async function () { calls += 1; return response(200, {}); }
  });
  await assert.rejects(
    service.analyze({ meeting_date:'2026-07-24' }, []),
    error => error.code === ANALYSIS_ERROR_CODES.CONFIGURATION
  );
  assert.equal(calls, 0);
});

test('model timeout and provider failures expose only safe error codes', async () => {
  const timeout = createMorningAnalysisService({
    apiKey:'test-key',
    timeoutMs:5,
    fetchImpl:function (url, options) {
      return new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', function () {
          const error = new Error('SECRET_TIMEOUT_DETAIL');
          error.name = 'AbortError';
          reject(error);
        });
      });
    }
  });
  await assert.rejects(
    timeout.analyze({ meeting_date:'2026-07-24' }, []),
    error => error.code === ANALYSIS_ERROR_CODES.TIMEOUT && !/SECRET/.test(error.message)
  );
  const provider = createMorningAnalysisService({
    apiKey:'test-key',
    fetchImpl:async function () { return response(500, { error:'SECRET_PROVIDER_BODY' }); }
  });
  await assert.rejects(
    provider.analyze({ meeting_date:'2026-07-24' }, []),
    error => error.code === ANALYSIS_ERROR_CODES.PROVIDER && !/SECRET/.test(error.message)
  );
});
