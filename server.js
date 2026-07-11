const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT || 4173);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'market.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS indicators (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    value REAL NOT NULL,
    previous_value REAL NOT NULL,
    value_unit TEXT NOT NULL DEFAULT '',
    change_type TEXT NOT NULL CHECK(change_type IN ('bp','percent')),
    source TEXT NOT NULL,
    as_of TEXT NOT NULL,
    frequency TEXT NOT NULL,
    is_manual INTEGER NOT NULL DEFAULT 0,
    is_featured INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS macro_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_time TEXT NOT NULL,
    region TEXT NOT NULL,
    name TEXT NOT NULL,
    importance INTEGER NOT NULL DEFAULT 3,
    previous TEXT,
    forecast TEXT,
    actual TEXT,
    source TEXT NOT NULL,
    is_manual INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

const seeds = [
 ['DR007','DR007','流动性',1.79,1.82,'%','bp','Wind 手工','2026-07-10','Daily Close',1,1,1],
 ['R001','R001','流动性',1.72,1.68,'%','bp','Wind 手工','2026-07-10','Daily Close',1,0,2],
 ['SOFR','SOFR','流动性',4.31,4.32,'%','bp','Federal Reserve','2026-07-09','Daily',0,1,3],
 ['RRP','美联储隔夜逆回购','流动性',113.2,119.8,'十亿美元','percent','Federal Reserve','2026-07-09','Daily',0,0,4],
 ['CN10Y','中国国债 10Y','利率',1.66,1.64,'%','bp','Wind 手工','2026-07-10','Realtime',1,1,1],
 ['CN30Y','中国国债 30Y','利率',1.88,1.87,'%','bp','Wind 手工','2026-07-10','Realtime',1,0,2],
 ['IRS1Y','FR007 IRS 1Y','利率',1.62,1.64,'%','bp','Wind 手工','2026-07-10','Daily Close',1,0,3],
 ['IRS5Y','FR007 IRS 5Y','利率',1.68,1.69,'%','bp','Wind 手工','2026-07-10','Daily Close',1,1,4],
 ['US2Y','美国国债 2Y','利率',4.12,4.09,'%','bp','FRED','2026-07-09','Daily Close',0,1,5],
 ['US10Y','美国国债 10Y','利率',4.54,4.523,'%','bp','FRED','2026-07-09','Daily Close',0,1,6],
 ['US30Y','美国国债 30Y','利率',4.86,4.83,'%','bp','FRED','2026-07-09','Daily Close',0,0,7],
 ['T.CFE','10Y 国债期货主力','国债期货',108.245,108.080,'','percent','Wind 手工','2026-07-10','Realtime',1,1,1],
 ['TL.CFE','30Y 国债期货主力','国债期货',119.820,119.360,'','percent','Wind 手工','2026-07-10','Realtime',1,0,2],
 ['TF.CFE','5Y 国债期货主力','国债期货',106.870,106.800,'','percent','Wind 手工','2026-07-10','Realtime',1,0,3],
 ['TS.CFE','2Y 国债期货主力','国债期货',102.380,102.350,'','percent','Wind 手工','2026-07-10','Realtime',1,0,4],
 ['DXY','美元指数','外汇',97.82,97.51,'','percent','Market Data','2026-07-10','15 min',0,1,1],
 ['USDCNY','美元/人民币','外汇',7.1832,7.1760,'','percent','Wind 手工','2026-07-10','Realtime',1,1,2],
 ['USDJPY','美元/日元','外汇',146.32,146.94,'','percent','Market Data','2026-07-10','15 min',0,0,3],
 ['EURUSD','欧元/美元','外汇',1.1712,1.1689,'','percent','Market Data','2026-07-10','15 min',0,0,4],
 ['CSI300','沪深 300','股票',4780.79,4876.31,'','percent','Wind 校验','2026-07-10','Daily Close',0,1,1],
 ['HSTECH','恒生科技','股票',5368.14,5412.70,'','percent','Exchange','2026-07-10','Realtime',0,1,2],
 ['SPX','标普 500','股票',6243.76,6229.98,'','percent','Market Data','2026-07-10','15 min',0,1,3],
 ['NDX','纳斯达克 100','股票',22702.25,22638.10,'','percent','Market Data','2026-07-10','15 min',0,0,4],
 ['GOLD','黄金','商品',3339.60,3314.20,'美元/盎司','percent','Market Data','2026-07-10','15 min',0,1,1],
 ['WTI','WTI 原油','商品',66.72,67.38,'美元/桶','percent','Market Data','2026-07-10','15 min',0,1,2],
 ['COPPER','伦铜','商品',9852.00,9776.50,'美元/吨','percent','Market Data','2026-07-10','15 min',0,1,3],
 ['SILVER','白银','商品',36.58,36.21,'美元/盎司','percent','Market Data','2026-07-10','15 min',0,0,4],
 ['VIX','VIX','波动率',15.78,16.21,'','percent','CBOE','2026-07-10','Realtime',0,1,1],
 ['MOVE','MOVE','波动率',92.40,91.70,'','percent','Market Data','2026-07-09','Daily Close',0,1,2],
 ['AAA3Y','AAA 3Y 信用利差','信用',41.5,42.8,'bp','bp','Wind 手工','2026-07-10','Daily Close',1,1,1],
 ['AA+3Y','AA+ 3Y 信用利差','信用',73.2,72.6,'bp','bp','Wind 手工','2026-07-10','Daily Close',1,0,2],
 ['AA3Y','AA 3Y 信用利差','信用',108.4,107.2,'bp','bp','Wind 手工','2026-07-10','Daily Close',1,0,3]
];

const insert = db.prepare(`INSERT OR IGNORE INTO indicators
 (symbol,name,category,value,previous_value,value_unit,change_type,source,as_of,frequency,is_manual,is_featured,sort_order)
 VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`);
db.exec('BEGIN');
for (const row of seeds) insert.run(...row);
// Only data without a stable automatic source belongs in the manual-maintenance queue.
db.exec(`
  UPDATE indicators
  SET is_manual = CASE
    WHEN symbol IN ('US2Y','US10Y','US30Y','CN10Y','CN30Y','SOFR','RRP','SPX','NDX','VIX','WTI','USDCNY','USDJPY','EURUSD') THEN 0
    ELSE 1
  END;
  UPDATE indicators
  SET value = 4780.79,
      previous_value = 4876.31,
      source = 'Wind 截图',
      as_of = '2026-07-10',
      frequency = 'Daily Close',
      is_manual = 1
  WHERE symbol = 'CSI300';
  UPDATE indicators
  SET source = '待手工录入', frequency = 'Manual'
  WHERE is_manual = 1
    AND source NOT IN ('Wind 手工','Wind 截图')
    AND category != '信用'
    AND symbol NOT LIKE 'IRS%';
`);
if (db.prepare('SELECT COUNT(*) c FROM macro_events').get().c === 0) {
  const event = db.prepare('INSERT INTO macro_events (event_time,region,name,importance,previous,forecast,actual,source) VALUES (?,?,?,?,?,?,?,?)');
  event.run('2026-07-11T09:30','中国','CPI 同比',4,'0.1%','0.2%','—','国家统计局');
  event.run('2026-07-11T20:30','美国','初请失业金人数',3,'233K','235K','—','U.S. DOL');
  event.run('2026-07-12T10:00','中国','央行公开市场操作',4,'净投放 300亿','—','—','中国人民银行');
}
db.exec('COMMIT');

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
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
const updateMarket = db.prepare(`UPDATE indicators SET value=?, previous_value=?, source=?, as_of=?, frequency=?, is_manual=0, updated_at=CURRENT_TIMESTAMP WHERE symbol=?`);

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
    updateMarket.run(treasury.latest[symbol], treasury.previous[symbol], 'U.S. Treasury', treasury.latest.date, 'Daily Close', symbol);
    results.push({ symbol, status: 'updated', as_of: treasury.latest.date });
  }
  try {
    const chinaBond = await fetchChinaBond();
    for (const symbol of ['CN10Y','CN30Y']) {
      updateMarket.run(chinaBond.latest[symbol], chinaBond.previous[symbol], 'ChinaBond · CCDC', chinaBond.latest.date, 'Daily Close', symbol);
      results.push({ symbol, status: 'updated', as_of: chinaBond.latest.date });
    }
  } catch (error) {
    results.push({ symbol: 'ChinaBond', status: 'error', error: error.message });
  }
  const fredResults = await Promise.allSettled(Object.entries(fredMap).map(async ([symbol, series]) => {
    const x = await fetchFred(series);
    updateMarket.run(x.value, x.previous, `FRED · ${series}`, x.date, 'Daily', symbol);
    return { symbol, status: 'updated', as_of: x.date };
  }));
  fredResults.forEach((r, i) => results.push(r.status === 'fulfilled' ? r.value : { symbol: Object.keys(fredMap)[i], status: 'error', error: r.reason.message }));
  return results;
}

const server = http.createServer(async (req,res)=>{
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname === '/api/indicators' && req.method === 'GET') return json(res,200,db.prepare('SELECT * FROM indicators ORDER BY category,sort_order,name').all());
    if (url.pathname === '/api/events' && req.method === 'GET') return json(res,200,db.prepare('SELECT * FROM macro_events ORDER BY event_time').all());
    if (url.pathname === '/api/refresh' && req.method === 'POST') {
      const results = await refreshAll();
      return json(res, results.some(x => x.status === 'error') ? 207 : 200, { results, refreshed_at: new Date().toISOString() });
    }
    if (url.pathname === '/api/indicators' && req.method === 'POST') {
      const x=await body(req); const err=validateIndicator(x); if(err)return json(res,400,{error:err});
      const info=db.prepare(`INSERT INTO indicators (symbol,name,category,value,previous_value,value_unit,change_type,source,as_of,frequency,is_manual,is_featured,sort_order)
        VALUES (?,?,?,?,?,?,?,?,?,?,1,?,?)`).run(x.symbol.trim(),x.name.trim(),x.category,Number(x.value),Number(x.previous_value),x.value_unit||'',x.change_type,x.source.trim(),x.as_of,x.frequency.trim(),x.is_featured?1:0,Number(x.sort_order||99));
      return json(res,201,db.prepare('SELECT * FROM indicators WHERE id=?').get(info.lastInsertRowid));
    }
    const match=url.pathname.match(/^\/api\/indicators\/(\d+)$/);
    if(match && req.method==='PUT') {
      const x=await body(req); const err=validateIndicator(x); if(err)return json(res,400,{error:err});
      const info=db.prepare(`UPDATE indicators SET symbol=?,name=?,category=?,value=?,previous_value=?,value_unit=?,change_type=?,source=?,as_of=?,frequency=?,is_manual=1,is_featured=?,sort_order=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`)
        .run(x.symbol.trim(),x.name.trim(),x.category,Number(x.value),Number(x.previous_value),x.value_unit||'',x.change_type,x.source.trim(),x.as_of,x.frequency.trim(),x.is_featured?1:0,Number(x.sort_order||99),Number(match[1]));
      if(!info.changes)return json(res,404,{error:'指标不存在'}); return json(res,200,db.prepare('SELECT * FROM indicators WHERE id=?').get(Number(match[1])));
    }
    if(url.pathname==='/api/events' && req.method==='POST') {
      const x=await body(req); if(!x.event_time||!x.region||!x.name||!x.source)return json(res,400,{error:'请填写事件时间、地区、名称和来源'});
      const info=db.prepare('INSERT INTO macro_events (event_time,region,name,importance,previous,forecast,actual,source,is_manual) VALUES (?,?,?,?,?,?,?,?,1)').run(x.event_time,x.region,x.name,Number(x.importance||3),x.previous||'',x.forecast||'',x.actual||'',x.source);
      return json(res,201,db.prepare('SELECT * FROM macro_events WHERE id=?').get(info.lastInsertRowid));
    }
    if(url.pathname.startsWith('/api/')) return json(res,404,{error:'接口不存在'});
    const requested=url.pathname==='/'?'index.html':url.pathname.slice(1);
    const file=path.normalize(path.join(ROOT,'public',requested));
    if(!file.startsWith(path.join(ROOT,'public'))) {res.writeHead(403);return res.end();}
    if(!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.writeHead(404);return res.end('Not found');}
    const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
    res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'}); fs.createReadStream(file).pipe(res);
  } catch(e) { json(res,e.code==='SQLITE_CONSTRAINT_UNIQUE'?409:500,{error:e.code==='SQLITE_CONSTRAINT_UNIQUE'?'代码已存在':e.message}); }
});
server.listen(PORT,()=>{
  console.log(`Market Workbench: http://localhost:${PORT}`);
  refreshAll().then(r => console.log(`Auto refresh: ${r.filter(x=>x.status==='updated').length} updated`)).catch(e => console.error('Auto refresh failed:', e.message));
});
