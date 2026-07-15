const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const config = require('./config');
const logger = require('./logger');
const { requireAuth } = require('./auth');
const { handleHealth } = require('./health');
const { validateJournal, validDate } = require('./journal');
const { getPool, query, closePool } = require('./database');

const PORT = config.port;
const ROOT = __dirname;

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', Buffer.byteLength(payload));
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Connection', 'close');
  res.shouldKeepAlive = false;
  res.end(payload);
}
function compatJson(res, status, body) {
  const buffer = Buffer.from(JSON.stringify(body), 'utf8');
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Length', buffer.length);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Connection', 'close');
  res.shouldKeepAlive = false;
  res.end(buffer);
}
function apiRow(row) {
  return row ? { ...row, id: Number(row.id) } : row;
}
function isEditorWriteRequest(req, url) {
  if (req.method === 'POST' && url.pathname === '/api/refresh') return true;
  if (req.method === 'POST' && url.pathname === '/api/indicators') return true;
  if (req.method === 'POST' && url.pathname === '/api/events') return true;
  return req.method === 'PUT' && /^\/api\/indicators\/\d+$/.test(url.pathname);
}
function body(req) { return new Promise((resolve,reject)=>{ let s=''; req.on('data',c=>{s+=c;if(s.length>1e6)reject(new Error('请求过大'));}); req.on('end',()=>{try{resolve(JSON.parse(s||'{}'))}catch(e){reject(e)}}); }); }
function validateIndicator(x) {
  const required=['symbol','name','category','value','previous_value','source','as_of','frequency','change_type'];
  if(required.some(k=>x[k]===undefined||x[k]===null||x[k]==='')) return '请填写所有必填字段';
  if(!['bp','percent'].includes(x.change_type)) return '涨跌类型无效';
  if(!Number.isFinite(Number(x.value))||!Number.isFinite(Number(x.previous_value))) return '当前值和前值必须是数字';
}

const fredMap = {
  SOFR: 'SOFR', RRP: 'RRPONTSYD', SPX: 'SP500', NDX: 'NASDAQ100',
  VIX: 'VIXCLS', WTI: 'DCOILWTICO',
  USDCNY: 'DEXCHUS', USDJPY: 'DEXJPUS', EURUSD: 'DEXUSEU'
};
async function updateMarket(value, previousValue, source, asOf, frequency, symbol) {
  await query(
    `UPDATE indicators
     SET value=$1, previous_value=$2, source=$3, as_of=$4, frequency=$5,
         is_manual=false, updated_at=CURRENT_TIMESTAMP
     WHERE symbol=$6`,
    [value, previousValue, source, asOf, frequency, symbol]
  );
}

async function fetchFred(seriesId) {
  const response = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(seriesId)}`, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`FRED ${seriesId}: HTTP ${response.status}`);
  const rows = (await response.text()).trim().split('\n').slice(1)
    .map(line => line.trim().split(','))
    .filter(row => row.length >= 2 && row[1] !== '' && Number.isFinite(Number(row[1])));
  if (rows.length < 2) throw new Error(`FRED ${seriesId}: insufficient observations`);
  const previous = rows.at(-2), latest = rows.at(-1);
  return { date: latest[0], value: Number(latest[1]), previous: Number(previous[1]) };
}

async function fetchTreasury() {
  const year = new Date().getFullYear();
  const url = `https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value=${year}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`U.S. Treasury: HTTP ${response.status}`);
  const xml = await response.text();
  const entries = [...xml.matchAll(/<entry>[\s\S]*?<\/entry>/g)].map(m => m[0]);
  const parsed = entries.map(entry => {
    const date = entry.match(/<d:NEW_DATE[^>]*>(\d{4}-\d{2}-\d{2})/i)?.[1];
    const get = tag => Number(entry.match(new RegExp(`<d:${tag}[^>]*>([^<]+)`, 'i'))?.[1]);
    return { date, US2Y: get('BC_2YEAR'), US10Y: get('BC_10YEAR'), US30Y: get('BC_30YEAR') };
  }).filter(x => x.date && Number.isFinite(x.US10Y));
  if (parsed.length < 2) throw new Error('U.S. Treasury: insufficient observations');
  return { previous: parsed.at(-2), latest: parsed.at(-1) };
}

function parseChinaBondTable(html, expectedDate) {
  const date = html.match(/<th>\s*(\d{4}-\d{2}-\d{2})\(%\)<\/th>/i)?.[1];
  if (!date || (expectedDate && date !== expectedDate)) return null;
  const row = html.match(/<tr>[\s\S]*?ChinaBond Government Bond Yield Curve[\s\S]*?<\/tr>/i)?.[0];
  if (!row) return null;
  const cleanRow = row.replace(/<!--[\s\S]*?-->/g, '');
  const values = [...cleanRow.matchAll(/<td[^>]*>\s*([0-9.]+)\s*<\/td>/gi)].map(m => Number(m[1]));
  if (values.length < 8) return null;
  return { date, CN10Y: values[6], CN30Y: values[7] };
}

async function fetchChinaBond() {
  const base = 'https://yield.chinabond.com.cn/cbweb-pbc-web/pbc';
  const main = await fetch(`${base}/more?locale=en_US`, { signal: AbortSignal.timeout(20000) });
  if (!main.ok) throw new Error(`ChinaBond: HTTP ${main.status}`);
  const mainHtml = await main.text();
  const latestDate = mainHtml.match(/id="gzr"[^>]*value="(\d{4}-\d{2}-\d{2})"/i)?.[1];
  if (!latestDate) throw new Error('ChinaBond: latest date not found');
  async function getDate(date) {
    const r = await fetch(`${base}/queryGjqxInfo?workTime=${date}&locale=en_US`, { method: 'POST', signal: AbortSignal.timeout(20000) });
    return r.ok ? parseChinaBondTable(await r.text(), date) : null;
  }
  const latest = await getDate(latestDate);
  if (!latest) throw new Error('ChinaBond: latest curve not found');
  let cursor = new Date(`${latestDate}T00:00:00Z`), previous = null;
  for (let i = 0; i < 7 && !previous; i++) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    previous = await getDate(cursor.toISOString().slice(0,10));
  }
  if (!previous) throw new Error('ChinaBond: previous curve not found');
  return { latest, previous };
}

async function refreshAll() {
  const results = [];
  const treasury = await fetchTreasury();
  for (const symbol of ['US2Y','US10Y','US30Y']) {
    await updateMarket(treasury.latest[symbol], treasury.previous[symbol], 'U.S. Treasury', treasury.latest.date, 'Daily Close', symbol);
    results.push({ symbol, status: 'updated', as_of: treasury.latest.date });
  }
  try {
    const chinaBond = await fetchChinaBond();
    for (const symbol of ['CN10Y','CN30Y']) {
      await updateMarket(chinaBond.latest[symbol], chinaBond.previous[symbol], 'ChinaBond · CCDC', chinaBond.latest.date, 'Daily Close', symbol);
      results.push({ symbol, status: 'updated', as_of: chinaBond.latest.date });
    }
  } catch (error) {
    results.push({ symbol: 'ChinaBond', status: 'error', error: error.message });
  }
  const fredResults = await Promise.allSettled(Object.entries(fredMap).map(async ([symbol, series]) => {
    const x = await fetchFred(series);
    await updateMarket(x.value, x.previous, `FRED · ${series}`, x.date, 'Daily', symbol);
    return { symbol, status: 'updated', as_of: x.date };
  }));
  fredResults.forEach((r, i) => results.push(r.status === 'fulfilled' ? r.value : { symbol: Object.keys(fredMap)[i], status: 'error', error: r.reason.message }));
  return results;
}

const server = http.createServer(async (req,res)=>{
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (isEditorWriteRequest(req, url) && !config.editorWriteEnabled) {
      return json(res,403,{error:'Public data editing is currently disabled'});
    }
    if (url.pathname === '/api/auth/me' && req.method === 'GET') {
      const user = await requireAuth(req, res, { config, sendJson:json, logger });
      if (!user) return;
      return json(res,200,user);
    }
    if (isEditorWriteRequest(req, url)) {
      const user = await requireAuth(req, res, { config, sendJson:json, logger });
      if (!user) return;
    }
    if (url.pathname === '/api/health' && req.method === 'GET') {
      return handleHealth({ query, sendJson:json, response:res, config });
    }
    if (url.pathname === '/api/dashboard' && req.method === 'GET') {
      const indicatorsResult = await query('SELECT * FROM indicators ORDER BY category,sort_order,name');
      const eventsResult = await query('SELECT * FROM macro_events ORDER BY event_time');
      return json(res,200,{
        indicators: indicatorsResult.rows.map(apiRow),
        events: eventsResult.rows.map(apiRow)
      });
    }
    if (url.pathname === '/api/dashboard-compat' && req.method === 'GET') {
      const indicatorsResult = await query('SELECT * FROM indicators ORDER BY category,sort_order,name');
      const eventsResult = await query('SELECT * FROM macro_events ORDER BY event_time');
      return compatJson(res,200,{
        indicators: indicatorsResult.rows.map(apiRow),
        events: eventsResult.rows.map(apiRow)
      });
    }
    if (url.pathname === '/api/indicators' && req.method === 'GET') {
      const result = await query('SELECT * FROM indicators ORDER BY category,sort_order,name');
      return json(res,200,result.rows.map(apiRow));
    }
    if (url.pathname === '/api/events' && req.method === 'GET') {
      const result = await query('SELECT * FROM macro_events ORDER BY event_time');
      return json(res,200,result.rows.map(apiRow));
    }
    const journalMatch=url.pathname.match(/^\/api\/journal\/(\d{4}-\d{2}-\d{2})$/);
    if(journalMatch && req.method==='GET') {
      if(!validDate(journalMatch[1])) return json(res,400,{error:'日志日期无效'});
      const result=await query('SELECT * FROM daily_market_notes WHERE note_date=$1',[journalMatch[1]]);
      return json(res,200,{date:journalMatch[1],note:apiRow(result.rows[0]||null)});
    }
    if(journalMatch && req.method==='PUT') {
      if(!validDate(journalMatch[1])) return json(res,400,{error:'日志日期无效'});
      const parsed=validateJournal(await body(req));
      if(parsed.error)return json(res,400,{error:parsed.error});
      const x=parsed.value;
      const symbols=Array.from(new Set(x.supporting_evidence.concat(x.opposing_evidence).map(item=>item.symbol)));
      if(symbols.length) {
        const known=await query('SELECT symbol FROM indicators WHERE symbol=ANY($1::text[])',[symbols]);
        const knownSymbols=new Set(known.rows.map(row=>row.symbol));
        const missing=symbols.filter(symbol=>!knownSymbols.has(symbol));
        if(missing.length)return json(res,400,{error:`证据指标不存在：${missing.join(', ')}`});
      }
      const result=await query(`INSERT INTO daily_market_notes
        (note_date,thesis,summary,supporting_evidence,opposing_evidence,watchlist)
        VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb)
        ON CONFLICT (note_date) DO UPDATE SET thesis=EXCLUDED.thesis,summary=EXCLUDED.summary,
          supporting_evidence=EXCLUDED.supporting_evidence,opposing_evidence=EXCLUDED.opposing_evidence,
          watchlist=EXCLUDED.watchlist,updated_at=CURRENT_TIMESTAMP
        RETURNING *`,[journalMatch[1],x.thesis,x.summary,JSON.stringify(x.supporting_evidence),JSON.stringify(x.opposing_evidence),JSON.stringify(x.watchlist)]);
      return json(res,200,{date:journalMatch[1],note:apiRow(result.rows[0])});
    }
    if (url.pathname === '/api/refresh' && req.method === 'POST') {
      const results = await refreshAll();
      return json(res, results.some(x => x.status === 'error') ? 207 : 200, { results, refreshed_at: new Date().toISOString() });
    }
    if (url.pathname === '/api/indicators' && req.method === 'POST') {
      const x=await body(req); const err=validateIndicator(x); if(err)return json(res,400,{error:err});
      const result=await query(`INSERT INTO indicators (symbol,name,category,value,previous_value,value_unit,change_type,source,as_of,frequency,is_manual,is_featured,sort_order)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11,$12) RETURNING *`,[x.symbol.trim(),x.name.trim(),x.category,Number(x.value),Number(x.previous_value),x.value_unit||'',x.change_type,x.source.trim(),x.as_of,x.frequency.trim(),Boolean(x.is_featured),Number(x.sort_order||99)]);
      return json(res,201,apiRow(result.rows[0]));
    }
    const match=url.pathname.match(/^\/api\/indicators\/(\d+)$/);
    if(match && req.method==='PUT') {
      const x=await body(req); const err=validateIndicator(x); if(err)return json(res,400,{error:err});
      const result=await query(`UPDATE indicators SET symbol=$1,name=$2,category=$3,value=$4,previous_value=$5,value_unit=$6,change_type=$7,source=$8,as_of=$9,frequency=$10,is_manual=true,is_featured=$11,sort_order=$12,updated_at=CURRENT_TIMESTAMP WHERE id=$13 RETURNING *`,
        [x.symbol.trim(),x.name.trim(),x.category,Number(x.value),Number(x.previous_value),x.value_unit||'',x.change_type,x.source.trim(),x.as_of,x.frequency.trim(),Boolean(x.is_featured),Number(x.sort_order||99),Number(match[1])]);
      if(!result.rowCount)return json(res,404,{error:'指标不存在'}); return json(res,200,apiRow(result.rows[0]));
    }
    if(url.pathname==='/api/events' && req.method==='POST') {
      const x=await body(req); if(!x.event_time||!x.region||!x.name||!x.source)return json(res,400,{error:'请填写事件时间、地区、名称和来源'});
      const result=await query('INSERT INTO macro_events (event_time,region,name,importance,previous,forecast,actual,source,is_manual) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true) RETURNING *',[x.event_time,x.region,x.name,Number(x.importance||3),x.previous||'',x.forecast||'',x.actual||'',x.source]);
      return json(res,201,apiRow(result.rows[0]));
    }
    if(url.pathname.startsWith('/api/')) return json(res,404,{error:'接口不存在'});
    const requested=url.pathname==='/'?'index.html':url.pathname.slice(1);
    const file=path.normalize(path.join(ROOT,'public',requested));
    const exists=fs.existsSync(file);
    if(!file.startsWith(path.join(ROOT,'public'))) {res.writeHead(403);return res.end();}
    if(!exists||fs.statSync(file).isDirectory()){res.writeHead(404);return res.end('Not found');}
    if (requested === 'index.html') {
      const html = fs.readFileSync(file, 'utf8')
        .replace('__APP_ENV_JSON__', JSON.stringify(config.appEnv))
        .replace('__DEBUG_PANEL_DEFAULT__', config.debugPanelDefault ? 'true' : 'false')
        .replace('__APP_COMMIT_JSON__', JSON.stringify(config.commit))
        .replace('__APP_VERSION_JSON__', JSON.stringify(config.version))
        .replace('__EDITOR_WRITE_ENABLED__', config.editorWriteEnabled ? 'true' : 'false')
        .replace('__AUTH_CONFIGURED__', config.authConfigured ? 'true' : 'false')
        .replace('__SUPABASE_URL_JSON__', JSON.stringify(config.supabaseUrl))
        .replace('__SUPABASE_PUBLISHABLE_KEY_JSON__', JSON.stringify(config.supabasePublishableKey))
        .replace(/__EDITOR_WRITE_HIDDEN__/g, config.editorWriteEnabled ? '' : 'hidden');
      const buffer = Buffer.from(html, 'utf8');
      res.writeHead(200, {'Content-Type':'text/html; charset=utf-8','Content-Length':buffer.length,'Cache-Control':'no-store'});
      return res.end(buffer);
    }
    const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
    res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-cache'}); fs.createReadStream(file).pipe(res);
  } catch(e) {
    if (e.code === '23505') return json(res,409,{error:'代码已存在'});
    logger.error(`API request failed: ${req.method} ${url.pathname}: ${e.message}`);
    return json(res,500,{error:'Internal server error'});
  }
});

async function start() {
  await query('SELECT 1');
  server.listen(PORT,'0.0.0.0',()=>logger.info(`Market Workbench started on port ${PORT} (${config.appEnv})`));
}

async function shutdown() {
  server.close(async () => {
    await closePool();
    process.exit(0);
  });
}

if (require.main === module) {
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  start().catch(async error => {
    logger.error(`Market Workbench failed to start: ${error.message}`);
    await closePool();
    process.exit(1);
  });
}

module.exports = { server, start, shutdown, isEditorWriteRequest };
