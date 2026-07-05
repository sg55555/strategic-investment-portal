// 束C DOM検証用フィクスチャ（Task 7-12 共通）。/api/market/list の {stocks, updated_at} 形。
// JP株2(成長あり) + US株1 + ETF1(financials空→ratio/成長 null)。CAGR/YoY/欠測/ETF 各経路を網羅。
// Playwright で page.route('**/api/market/list', r => r.fulfill({ json: FIXTURE })) して使う。
const FIXTURE = {
  updated_at: "2026-07-05 12:00",
  stocks: {
    // トヨタ相当：売上 37M→45M→48M（CAGR≈13.9% / 直近YoY≈6.7%）、純利益 2.45M→4.94M→4.765M（直近YoY≈-3.5% / CAGR≈39.4%）
    "7203.T": {
      company_name: "トヨタ自動車", industry: "自動車", currency: "JPY", country: "JP", type: "stock",
      marketCap: 40000000, per: 10, pbr: 1.1, prices: [],
      financials_trend: {
        "2023": { net_sales: 37000000, operating_income: 2700000, net_income: 2450000, net_assets: 28000000, current_assets: 22000000, non_current_assets: 52000000, current_liabilities: 20000000, non_current_liabilities: 18000000, year: 2023 },
        "2024": { net_sales: 45000000, operating_income: 5350000, net_income: 4940000, net_assets: 36000000, current_assets: 28000000, non_current_assets: 60000000, current_liabilities: 24000000, non_current_liabilities: 20000000, year: 2024 },
        "2025": { net_sales: 48000000, operating_income: 4800000, net_income: 4765000, net_assets: 45000000, current_assets: 30000000, non_current_assets: 60000000, current_liabilities: 25000000, non_current_liabilities: 20000000, year: 2025 },
      },
    },
    // ソニー相当：売上 9M→11M→13M（CAGR≈20%）、純利益 0.8M→0.9M→1.0M
    "6758.T": {
      company_name: "ソニーグループ", industry: "電気機器", currency: "JPY", country: "JP", type: "stock",
      marketCap: 15000000, per: 18, pbr: 2.2, prices: [],
      financials_trend: {
        "2023": { net_sales: 9000000, operating_income: 900000, net_income: 800000, net_assets: 6000000, current_assets: 5000000, non_current_assets: 7000000, current_liabilities: 4000000, non_current_liabilities: 2000000, year: 2023 },
        "2024": { net_sales: 11000000, operating_income: 1100000, net_income: 900000, net_assets: 6800000, current_assets: 5600000, non_current_assets: 7600000, current_liabilities: 4200000, non_current_liabilities: 2200000, year: 2024 },
        "2025": { net_sales: 13000000, operating_income: 1400000, net_income: 1000000, net_assets: 7500000, current_assets: 6000000, non_current_assets: 8000000, current_liabilities: 4300000, non_current_liabilities: 2200000, year: 2025 },
      },
    },
    // Apple相当（米国株・USD）：売上 350000→380000→400000（百万ドル）
    "AAPL": {
      company_name: "Apple", industry: "US - テクノロジー", currency: "USD", country: "US", type: "stock",
      marketCap: 3000000, per: 30, pbr: 45, prices: [],
      financials_trend: {
        "2023": { net_sales: 350000, operating_income: 105000, net_income: 95000, net_assets: 62000, current_assets: 135000, non_current_assets: 217000, current_liabilities: 145000, non_current_liabilities: 145000, year: 2023 },
        "2024": { net_sales: 380000, operating_income: 118000, net_income: 100000, net_assets: 66000, current_assets: 140000, non_current_assets: 220000, current_liabilities: 140000, non_current_liabilities: 148000, year: 2024 },
        "2025": { net_sales: 400000, operating_income: 125000, net_income: 105000, net_assets: 70000, current_assets: 145000, non_current_assets: 220000, current_liabilities: 138000, non_current_liabilities: 145000, year: 2025 },
      },
    },
    // 国内ETF：financials_trend 空 → ratio/成長すべて null・isEtf true
    "1321.T": {
      company_name: "日経225連動型ETF", industry: "国内ETF", currency: "JPY", country: "JP", type: "etf",
      marketCap: 5000000, per: 0, pbr: 0, prices: [], financials_trend: {},
    },
  },
};

if (typeof module !== "undefined" && module.exports) module.exports = { FIXTURE };
