// api/domestic.js — 新浪财经 + 腾讯财经 双源
// 替换掉原来的 domestic.js

// 新浪期货代码映射
const SINA_MAP = {
  'CL':  'nf_SCmain',   // 上海原油
  'GC':  'nf_AUmain',   // 黄金
  'SI':  'nf_AGmain',   // 白银
  'HG':  'nf_CUmain',   // 铜
  'ALI': 'nf_ALmain',   // 铝
  'ZS':  'nf_Amain',    // 大豆
  'ZC':  'nf_Cmain',    // 玉米
  'ZW':  'nf_WHmain',   // 强麦
  'ES':  'nf_IFmain',   // 沪深300股指
  'ZN':  'nf_Tmain',    // 国债
};

const FALLBACK = {
  'CL':  { price: 535,   change: 0 },
  'GC':  { price: 780,   change: 0 },
  'SI':  { price: 8500,  change: 0 },
  'HG':  { price: 78000, change: 0 },
  'ALI': { price: 20000, change: 0 },
  'ZS':  { price: 3800,  change: 0 },
  'ZC':  { price: 2300,  change: 0 },
  'ZW':  { price: 2600,  change: 0 },
  'ES':  { price: 3800,  change: 0 },
  'ZN':  { price: 104,   change: 0 },
};

// 批量拉取新浪期货行情
async function fetchSinaBatch(symbols) {
  try {
    const sinaSyms = symbols.map(s => SINA_MAP[s]).filter(Boolean).join(',');
    const url = `https://hq.sinajs.cn/list=${sinaSyms}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(6000),
      headers: {
        'Referer': 'https://finance.sina.com.cn/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      }
    });
    if (!res.ok) return null;
    const text = await res.text();
    // 解析：var hq_str_nf_SCmain="上海原油2506,535.2,534.8,530.0,537.5,535.0,..."
    const result = {};
    for (const sym of symbols) {
      const sinaSym = SINA_MAP[sym];
      if (!sinaSym) continue;
      const regex = new RegExp(`hq_str_${sinaSym}="([^"]+)"`);
      const match = text.match(regex);
      if (!match) continue;
      const parts = match[1].split(',');
      // 新浪期货字段: [名称, 今开, 昨收, 最新, 最高, 最低, ...]
      const price = parseFloat(parts[3]);
      const prev  = parseFloat(parts[2]);
      if (!price || price <= 0) continue;
      result[sym] = {
        price,
        change: prev > 0 ? ((price - prev) / prev * 100) : 0,
        high:   parseFloat(parts[4]) || price,
        low:    parseFloat(parts[5]) || price,
        source: 'sina',
      };
    }
    return Object.keys(result).length > 0 ? result : null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=60');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const { symbols } = req.query;
  const symbolList = symbols
    ? symbols.split(',').map(s => s.trim().toUpperCase())
    : Object.keys(SINA_MAP);

  // 批量拉取新浪数据
  const sinaData = await fetchSinaBatch(symbolList);

  const results = {};
  for (const sym of symbolList) {
    const live = sinaData?.[sym];
    if (live) {
      results[sym] = { ...live, updatedAt: new Date().toISOString() };
    } else {
      const fb = FALLBACK[sym] || { price: 0, change: 0 };
      results[sym] = { ...fb, high: fb.price, low: fb.price, source: 'fallback', updatedAt: new Date().toISOString() };
    }
  }

  const liveCount = Object.values(results).filter(r => r.source === 'sina').length;

  return res.status(200).json({
    success: true,
    data: results,
    liveCount,
    total: symbolList.length,
    timestamp: new Date().toISOString(),
  });
}
