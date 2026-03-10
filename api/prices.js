
// api/prices.js
// Vercel Serverless Function
// 访问路径: https://你的域名/api/prices?symbols=CL,GC,SI

const FINNHUB_KEY = process.env.FINNHUB_KEY;

// ── Finnhub 期货符号映射（免费版实际支持有限，主要靠Yahoo兜底）──
const FINNHUB_MAP = {
  'CL':  'CL1!',
  'GC':  'GC1!',
  'SI':  'SI1!',
  'HG':  'HG1!',
  'ALI': 'ALI=F',
  'ZS':  'ZS1!',
  'ZC':  'ZC1!',
  'ZW':  'ZW1!',
  'ES':  'ES1!',
  'ZN':  'ZN1!',
};

// ── Yahoo Finance 符号映射（服务端调用，无跨域）──
const YAHOO_MAP = {
  'CL':  'CL=F',    // WTI 原油
  'GC':  'GC=F',    // 黄金
  'SI':  'SI=F',    // 白银
  'HG':  'HG=F',    // 铜
  'ALI': 'ALI=F',   // 铝
  'ZS':  'ZS=F',    // 大豆
  'ZC':  'ZC=F',    // 玉米
  'ZW':  'ZW=F',    // 小麦
  'ES':  'ES=F',    // 标普500 E-mini
  'ZN':  'ZN=F',    // 10年期美债
};

// ── 静态 fallback（Yahoo 也失败时使用）──
const FALLBACK = {
  'CL':  { price: 73.0,   change: 0 },
  'GC':  { price: 2750.0, change: 0 },
  'SI':  { price: 31.5,   change: 0 },
  'HG':  { price: 4.45,   change: 0 },
  'ALI': { price: 1.18,   change: 0 },
  'ZS':  { price: 980.0,  change: 0 },
  'ZC':  { price: 450.0,  change: 0 },
  'ZW':  { price: 540.0,  change: 0 },
  'ES':  { price: 5800.0, change: 0 },
  'ZN':  { price: 109.0,  change: 0 },
};

// ─────────────────────────────────────────────
// ① 尝试 Finnhub
// ─────────────────────────────────────────────
async function fetchFinnhub(sym) {
  const finnhubSym = FINNHUB_MAP[sym];
  if (!finnhubSym || !FINNHUB_KEY) return null;
  try {
    const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(finnhubSym)}&token=${FINNHUB_KEY}`;
    const res  = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.c || data.c === 0) return null;
    return {
      price:     data.c,
      change:    data.dp ?? 0,
      high:      data.h,
      low:       data.l,
      prevClose: data.pc,
      volume:    data.v || 0,
      source:    'finnhub',
    };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────
// ② 备用 Yahoo Finance（服务端无跨域问题）
// ─────────────────────────────────────────────
async function fetchYahoo(sym) {
  const yahooSym = YAHOO_MAP[sym];
  if (!yahooSym) return null;
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=1m&range=1d`;
    const res  = await fetch(url, {
      signal: AbortSignal.timeout(6000),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      }
    });
    if (!res.ok) return null;
    const json = await res.json();
    const meta = json?.chart?.result?.[0]?.meta;
    if (!meta || !meta.regularMarketPrice) return null;
    const price = meta.regularMarketPrice;
    const prev  = meta.previousClose || price;
    return {
      price,
      change:    ((price - prev) / prev * 100),
      high:      meta.regularMarketDayHigh || price,
      low:       meta.regularMarketDayLow  || price,
      prevClose: prev,
      volume:    meta.regularMarketVolume  || 0,
      source:    'yahoo',
    };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────
// ③ 备用 Yahoo Finance（query2 镜像，query1失败时）
// ─────────────────────────────────────────────
async function fetchYahoo2(sym) {
  const yahooSym = YAHOO_MAP[sym];
  if (!yahooSym) return null;
  try {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=1m&range=1d`;
    const res  = await fetch(url, {
      signal: AbortSignal.timeout(6000),
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    if (!res.ok) return null;
    const json = await res.json();
    const meta = json?.chart?.result?.[0]?.meta;
    if (!meta || !meta.regularMarketPrice) return null;
    const price = meta.regularMarketPrice;
    const prev  = meta.previousClose || price;
    return {
      price,
      change:    ((price - prev) / prev * 100),
      high:      meta.regularMarketDayHigh || price,
      low:       meta.regularMarketDayLow  || price,
      prevClose: prev,
      volume:    meta.regularMarketVolume  || 0,
      source:    'yahoo2',
    };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────
// 主 Handler
// ─────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=25, stale-while-revalidate=55');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { symbols } = req.query;
  if (!symbols) {
    return res.status(400).json({ error: 'symbols 参数必填，例如: ?symbols=CL,GC,SI' });
  }

  const symbolList = symbols.split(',').map(s => s.trim().toUpperCase());
  const results    = {};

  await Promise.allSettled(
    symbolList.map(async (sym) => {
      // 按优先级依次尝试：Finnhub → Yahoo query1 → Yahoo query2 → fallback
      let data = await fetchFinnhub(sym);

      if (!data) {
        data = await fetchYahoo(sym);
      }

      if (!data) {
        data = await fetchYahoo2(sym);
      }

      if (!data) {
        // 全部失败，使用 fallback
        const fb = FALLBACK[sym];
        data = fb
          ? { ...fb, high: fb.price, low: fb.price, prevClose: fb.price, volume: 0, source: 'fallback' }
          : { price: 0, change: 0, source: 'error' };
      }

      results[sym] = {
        ...data,
        updatedAt: new Date().toISOString(),
      };
    })
  );

  // 统计实时数量
  const liveCount = Object.values(results).filter(
    r => r.source === 'finnhub' || r.source === 'yahoo' || r.source === 'yahoo2'
  ).length;

  return res.status(200).json({
    success:    true,
    data:       results,
    liveCount,
    total:      symbolList.length,
    timestamp:  new Date().toISOString(),
  });
}
