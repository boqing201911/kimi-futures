
// api/fx.js
// Vercel Serverless Function
// 访问路径: https://你的域名/api/fx

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60'); // 汇率1分钟缓存

  try {
    const response = await fetch(
      'https://open.er-api.com/v6/latest/USD',
      { signal: AbortSignal.timeout(5000) }
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    if (data.result !== 'success') throw new Error('API返回失败');

    return res.status(200).json({
      success: true,
      rates: {
        CNY: data.rates.CNY,
        JPY: data.rates.JPY,
        EUR: data.rates.EUR,
        HKD: data.rates.HKD,
      },
      updatedAt: data.time_last_update_utc,
      source: 'live',
    });
  } catch (err) {
    // 返回备用汇率，保证前端不崩溃
    return res.status(200).json({
      success: false,
      rates: { CNY: 7.25, JPY: 149.5, EUR: 0.92, HKD: 7.82 },
      source: 'fallback',
      error: err.message,
    });
  }
}
