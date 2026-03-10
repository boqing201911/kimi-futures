
// api/domestic.js
// Vercel Serverless Function
// 访问路径: https://你的域名/api/domestic
// 数据源: 东方财富 push2 接口（服务端调用，无跨域限制）

// ── 国内期货 secid 映射表 ──
// 格式: 交易所代码.合约代码
// 113=上期所/上期能源, 114=大商所, 115=郑商所, 142=中金所
const SECID_MAP = {
  'SC':  '113.SC0',   // 上海原油 (INE)
  'AU':  '113.AU0',   // 黄金 (SHFE)
  'AG':  '113.AG0',   // 白银 (SHFE)
  'CU':  '113.CU0',   // 铜 (SHFE)
  'AL':  '113.AL0',   // 铝 (SHFE)
  'A':   '114.A0',    // 大豆 (DCE)
  'C':   '114.C0',    // 玉米 (DCE)
  'WH':  '115.WH0',   // 强麦 (ZCE)
  'IF':  '142.IF0',   // 沪深300股指 (CFFEX)
  'T':   '142.T0',    // 国债10年 (CFFEX)
};

// 前端 symbol → 国内合约代码 映射
const FRONTEND_TO_DOMESTIC = {
  'CL':  'SC',   // 原油
  'GC':  'AU',   // 黄金
  'SI':  'AG',   // 白银
  'HG':  'CU',   // 铜
  'ALI': 'AL',   // 铝
  'ZS':  'A',    // 大豆
  'ZC':  'C',    // 玉米
  'ZW':  'WH',   // 强麦
  'ES':  'IF',   // 股指
  'ZN':  'T',    // 国债
};

// fallback 价格（全部接口失败时）
const FALLBACK = {
  'CL':  { price: 535,   change: 0 },
  'GC':  { price: 625,   change: 0 },
  'SI':  { price: 8500,  change: 0 },
  'HG':  { price: 78000, change: 0 },
  'ALI': { price: 20000, change: 0 },
  'ZS':  { price: 3800,  change: 0 },
  'ZC':  { price: 2300,  change: 0 },
  'ZW':  { price: 2600,  change: 0 },
  'ES':  { price: 3800,  change: 0 },
  'ZN':  { price: 104,   change: 0 },
};

// ─────────────────────────────────────────────
// 东方财富单品种查询
// 返回字段说明:
//   f43: 最新价 (×100)
//   f170: 涨跌幅% (×100)
//   f44: 最高 (×100)
//   f45: 最低 (×100)
//   f47: 成交量（手）
//   f48: 成交额
//   f168: 换手率
// ─────────────────────────────────────────────
async function fetchEastMoney(secid) {
  try {
    const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f43,f44,f45,f47,f48,f168,f169,f170&ut=bd1d9ddb04089700cf9c27f6f7426281`;
    const res  = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: {
        'Referer':    'https://quote.eastmoney.com/',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      }
    });
    if (!res.ok) return null;
    const json = await res.json();
    const d    = json?.data;

    // f43 <= 0 说明数据无效（可能停牌/休市且无收盘价）
    if (!d || !d.f43 || d.f43 <= 0) return null;

    return {
      price:  d.f43  / 100,
      change: d.f170 / 100,
      high:   d.f44  / 100,
      low:    d.f45  / 100,
      volume: d.f47  || 0,
      source: 'eastmoney',
    };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────
// 备用：东方财富 push2delay 节点
// ─────────────────────────────────────────────
async function fetchEastMoneyDelay(secid) {
  try {
    const url = `https://push2delay.eastmoney.com/api/qt/stock/get?secid=${secid}&fields=f43,f44,f45,f47,f170&ut=bd1d9ddb04089700cf9c27f6f7426281`;
    const res  = await fetch(url, {
      signal: AbortSignal.timeout(6000),
      headers: {
        'Referer':    'https://quote.eastmoney.com/',
        'User-Agent': 'Mozilla/5.0',
      }
    });
    if (!res.ok) return null;
    const json = await res.json();
    const d    = json?.data;
    if (!d || !d.f43 || d.f43 <= 0) return null;
    return {
      price:  d.f43  / 100,
      change: d.f170 / 100,
      high:   d.f44  / 100,
      low:    d.f45  / 100,
      volume: d.f47  || 0,
      source: 'eastmoney_delay',
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
  // 休市时间段缓存时间可以长一点（5分钟）
  res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  // 支持指定 symbols，不传则返回全部
  const { symbols } = req.query;
  const symbolList = symbols
    ? symbols.split(',').map(s => s.trim().toUpperCase())
    : Object.keys(FRONTEND_TO_DOMESTIC);

  const results = {};

  await Promise.allSettled(
    symbolList.map(async (frontendSym) => {
      const domCode = FRONTEND_TO_DOMESTIC[frontendSym];
      if (!domCode) {
        results[frontendSym] = { error: '未知品种', source: 'error' };
        return;
      }
      const secid = SECID_MAP[domCode];

      // 依次尝试：主节点 → delay节点 → fallback
      let data = await fetchEastMoney(secid);
      if (!data) data = await fetchEastMoneyDelay(secid);

      if (!data) {
        const fb = FALLBACK[frontendSym];
        data = fb
          ? { ...fb, high: fb.price, low: fb.price, volume: 0, source: 'fallback' }
          : { price: 0, change: 0, source: 'error' };
      }

      results[frontendSym] = {
        ...data,
        updatedAt: new Date().toISOString(),
      };
    })
  );

  const liveCount = Object.values(results).filter(
    r => r.source === 'eastmoney' || r.source === 'eastmoney_delay'
  ).length;

  // 判断是否休市（中国期货时间）
  const now = new Date();
  const bjHour = (now.getUTCHours() + 8) % 24;
  const bjMin  = now.getUTCMinutes();
  const bjDay  = (now.getUTCDay() + (bjHour < 0 ? -1 : 0) + 7) % 7;
  const isWeekend = bjDay === 0 || bjDay === 6;
  const isDaySession   = bjHour >= 9  && (bjHour < 15 || (bjHour === 15 && bjMin === 0));
  const isNightSession = bjHour >= 21 || bjHour < 3;
  const isTradingTime  = !isWeekend && (isDaySession || isNightSession);

  return res.status(200).json({
    success:         true,
    data:            results,
    liveCount,
    total:           symbolList.length,
    isTradingTime,
    marketNote:      isTradingTime ? '交易时段' : '休市中（显示最近收盘价）',
    timestamp:       new Date().toISOString(),
  });
}
</thinking>

接下来，更新 `index.html` 里对应的数据获取逻辑，让它同时调用 `/api/domestic`：

在 `index.html` 的 `refresh()` 函数里，把 `fetch` 那行改成**三个并发请求**：

```javascript
const [fxRes, pricesRes, domRes] = await Promise.allSettled([
    fetch('/api/fx').then(r => r.json()),
    fetch('/api/prices?symbols=CL,GC,SI,HG,ALI,ZS,ZC,ZW,ES,ZN').then(r => r.json()),
    fetch('/api/domestic').then(r => r.json())   // ← 新增这行
]);
```

然后处理国内数据，把原来写死 fallback 的那段替换：

```javascript
// 处理国内行情
let domMap = {};
if (domRes.status === 'fulfilled' && domRes.value.success) {
    domMap = domRes.value.data || {};
}

// 在 PAIRS.map() 里，把这段：
// const domPrice  = pair.fallback.dom * (1 + (Math.random()-0.5)*0.002);
// const domChange = (Math.random()-0.5)*0.5;
// const domSrc    = 'fallback';

// 替换成：
const domRaw    = domMap[pair.intl.symbol];
const domPrice  = domRaw?.price  ?? pair.fallback.dom;
const domChange = domRaw?.change ?? 0;
const domSrc    = domRaw?.source ?? 'fallback';
```

---

## 操作步骤

| 步骤 | 操作 |
|------|------|
| ① | GitHub → `api/` 文件夹 → `Create new file` → 命名 `domestic.js` → 粘贴上面代码 → Commit |
| ② | 修改 `index.html` 里的 `refresh()` 函数（两处改动）|
| ③ | Vercel 自动部署，约1分钟 |

---

## 休市期间数据表现

```
日盘 09:00~15:00  → 🟢 实时价格
夜盘 21:00~02:30  → 🟢 实时价格（原油、黄金有夜盘）
休市 15:00~21:00  → 🟡 显示最近收盘价（这是正常的）
                       东方财富接口会返回当天收盘价，不会是0
```

现在是 16:35，INE 日盘已收市，所以显示的 534.86 如果接口通了，**会显示今天收盘价**，这是正确的。等 21:00 夜盘开始后就会变成实时价了。
