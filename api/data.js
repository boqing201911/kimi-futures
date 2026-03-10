// api/data.js - Vercel Serverless Function
// 这个文件运行在Vercel服务器上，可以绕过浏览器CORS限制

export default async function handler(req, res) {
  // 设置CORS头，允许前端访问
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  const { type, symbol } = req.query;
  
  try {
    let data;
    
    switch(type) {
      case 'domestic':
        // 东方财富 - 国内期货
        data = await fetchEastMoney(symbol);
        break;
      case 'international':
        // 新浪财经 - 国际期货
        data = await fetchSina(symbol);
        break;
      case 'fx':
        // 实时汇率
        data = await fetchExchangeRate();
        break;
      case 'batch':
        // 批量获取所有数据（优化性能）
        data = await fetchBatchData();
        break;
      default:
        throw new Error('Unknown type');
    }
    
    res.status(200).json({ success: true, data, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
}

// 东方财富API - 国内期货
async function fetchEastMoney(symbol) {
  // 113开头是上期所，114是大商所，115是郑商所，142是中金所，8是能源中心
  const exchangeMap = {
    'AU0': '113', 'AG0': '113', 'CU0': '113', 'AL0': '113',  // 上期所
    'SC0': '142',  // 能源中心（用142或8）
    'A0': '114', 'C0': '114',  // 大商所
    'WH0': '115'  // 郑商所
  };
  
  const secid = exchangeMap[symbol] || '113';
  const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}.${symbol}&fields=f43,f44,f45,f46,f47,f48,f57,f58,f60,f170,f171`;
  
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://quote.eastmoney.com/'
    }
  });
  
  const result = await response.json();
  
  if (!result.data) {
    throw new Error('EastMoney: No data returned');
  }
  
  const d = result.data;
  return {
    price: d.f43 ? d.f43 / 100 : 0,        // 最新价
    open: d.f44 ? d.f44 / 100 : 0,         // 开盘价
    high: d.f46 ? d.f46 / 100 : 0,         // 最高价
    low: d.f45 ? d.f45 / 100 : 0,          // 最低价
    volume: d.f47 || 0,                     // 成交量
    amount: d.f48 || 0,                     // 成交额
    change: d.f170 ? d.f170 / 100 : 0,     // 涨跌幅%
    changeAmount: d.f171 ? d.f171 / 100 : 0, // 涨跌额
    name: d.f58,                            // 中文名
    code: d.f57                             // 代码
  };
}

// 新浪财经API - 国际期货
async function fetchSina(symbol) {
  // hf_ 前缀是外盘期货
  const url = `https://hq.sinajs.cn/list=hf_${symbol.toLowerCase()}`;
  
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://finance.sina.com.cn/'
    }
  });
  
  const text = await response.text();
  
  // 解析新浪返回的JavaScript: var hq_str_hf_gc="2050.5,12.3,0.6,..."
  const match = text.match(/var hq_str_hf_[^=]+="([^"]*)"/);
  if (!match || !match[1]) {
    throw new Error('Sina: No data returned');
  }
  
  const parts = match[1].split(',');
  if (parts.length < 10) {
    throw new Error('Sina: Invalid data format');
  }
  
  // 新浪外盘期货字段说明：
  // 0: 最新价, 1: 涨跌额, 2: 买价, 3: 卖价, 4: 最高价, 5: 最低价, 
  // 6: 昨收, 7: 开盘价, 8: 持仓量, 9: 买量, 10: 卖量, 11: 日期, 12: 时间
  
  const price = parseFloat(parts[0]) || 0;
  const prevClose = parseFloat(parts[6]) || price;
  const change = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;
  
  return {
    price: price,
    change: change,
    open: parseFloat(parts[7]) || 0,
    high: parseFloat(parts[4]) || 0,
    low: parseFloat(parts[5]) || 0,
    prevClose: prevClose,
    bid: parseFloat(parts[2]) || 0,
    ask: parseFloat(parts[3]) || 0,
    volume: parseInt(parts[9]) || 0,  // 买量作为成交量参考
    time: `${parts[11]} ${parts[12]}`
  };
}

// 实时汇率
async function fetchExchangeRate() {
  // 使用多个汇率源确保稳定性
  const sources = [
    'https://api.exchangerate-api.com/v4/latest/USD',
    'https://open.er-api.com/v6/latest/USD'
  ];
  
  for (const url of sources) {
    try {
      const response = await fetch(url);
      const data = await response.json();
      if (data && (data.rates?.CNY || data.rates?.cny)) {
        return {
          usdCny: data.rates.CNY || data.rates.cny,
          timestamp: new Date().toISOString()
        };
      }
    } catch (e) {
      continue;
    }
  }
  
  // 备用：使用固定汇率（实际应该记录上次成功值）
  return { usdCny: 7.245, timestamp: new Date().toISOString(), cached: true };
}

// 批量获取所有数据（性能优化）
async function fetchBatchData() {
  const pairs = [
    { id: 'gold', name: '黄金', domestic: 'AU0', international: 'GC', fx: true, conversion: 31.1035 },
    { id: 'silver', name: '白银', domestic: 'AG0', international: 'SI', fx: true, conversion: 32.1507 },
    { id: 'copper', name: '铜', domestic: 'CU0', international: 'CAD', fx: true, conversion: 1 },
    { id: 'crude', name: '原油', domestic: 'SC0', international: 'CL', fx: true, conversion: 1 },
    { id: 'soybean', name: '大豆', domestic: 'A0', international: 'ZS', fx: true, conversion: 36.7437 },
    { id: 'corn', name: '玉米', domestic: 'C0', international: 'ZC', fx: true, conversion: 39.3683 },
    { id: 'wheat', name: '小麦', domestic: 'WH0', international: 'ZW', fx: true, conversion: 36.7437 },
    { id: 'aluminum', name: '铝', domestic: 'AL0', international: 'AHD', fx: true, conversion: 1 }
  ];
  
  // 先获取汇率
  const fxData = await fetchExchangeRate();
  
  // 并行获取所有期货数据
  const results = await Promise.all(
    pairs.map(async (pair) => {
      try {
        const [domestic, international] = await Promise.all([
          fetchEastMoney(pair.domestic).catch(() => null),
          fetchSina(pair.international).catch(() => null)
        ]);
        
        if (!domestic || !international) return null;
        
        // 计算溢价率
        const intlConverted = international.price * fxData.usdCny * pair.conversion;
        const premium = ((domestic.price - intlConverted) / intlConverted) * 100;
        
        return {
          ...pair,
          domesticPrice: domestic.price,
          domesticChange: domestic.change,
          domesticVolume: domestic.volume,
          intlPrice: international.price,
          intlChange: international.change,
          intlTime: international.time,
          premium: premium,
          fxRate: fxData.usdCny
        };
      } catch (e) {
        console.error(`Error fetching ${pair.id}:`, e);
        return null;
      }
    })
  );
  
  return {
    pairs: results.filter(r => r !== null),
    fxRate: fxData.usdCny,
    fxCached: fxData.cached || false,
    timestamp: new Date().toISOString()
  };
}
