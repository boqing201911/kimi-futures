
// api/prices.js
// Vercel Serverless Function
// 部署后访问路径: https://你的域名/api/prices?symbols=CL=F,GC=F

const FINNHUB_KEY = process.env.FINNHUB_KEY; // 从 Vercel 环境变量读取，不要硬编码

// Finnhub symbol 映射表
const SYMBOL_MAP = {
  'CL':  'CL1!',   // WTI原油 (NYMEX)
  'GC':  'GC1!',   // 黄金 (COMEX)
  'SI':  'SI1!',   // 白银 (COMEX)
  'HG':  'HG1!',   // 铜 (COMEX)
  'ALI': 'ALI1!',  // 铝 (COMEX)
  'ZS':  'ZS1!',   // 大豆 (CBOT)
  'ZC':  'ZC1!',   // 玉米 (CBOT)
  'ZW':  'ZW1!',   // 小麦 (CBOT)
  'ES':  'ES1!',   // 标普500 E-mini (CME)
  'ZN':  'ZN1!',   // 10年期美债 (CME)
};

export default async function handler(req, res) {
  // 允许跨域（前端页面调用）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  res.setHeader('Cache-Control', 's-maxage=30'); // Vercel CDN 缓存30秒

  const { symbols } = req.query; // 例如: ?symbols=CL,GC,SI
  if (!symbols) {
    return res.status(400).json({ error: 'symbols 参数必填，例如: ?symbols=CL,GC,SI' });
  }

  const symbolList = symbols.split(',').map(s => s.trim());
  const results = {};

  // 并发请求所有 symbol
  await Promise.allSettled(
    symbolList.map(async (sym) => {
      const finnhubSym = SYMBOL_MAP[sym];
      if (!finnhubSym) {
        results[sym] = { error: '未知symbol', source: 'error' };
        return;
      }
      try {
        const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(finnhubSym)}&token=${FINNHUB_KEY}`;
        const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();

        // Finnhub 返回格式: { c: 当前价, d: 涨跌额, dp: 涨跌幅%, h: 最高, l: 最低, o: 开盘, pc: 昨收, v: 成交量 }
        if (!data.c || data.c === 0) throw new Error('无效数据');

        results[sym] = {
          price:     data.c,    // 当前价
          change:    data.dp,   // 涨跌幅 %
          high:      data.h,
          low:       data.l,
          prevClose: data.pc,
          volume:    data.v || 0,
          source:    'live',
          updatedAt: new Date().toISOString(),
        };
      } catch (err) {
        results[sym] = { error: err.message, source: 'error' };
      }
    })
  );

  return res.status(200).json({
    success: true,
    data: results,
    timestamp: new Date().toISOString(),
  });
}
