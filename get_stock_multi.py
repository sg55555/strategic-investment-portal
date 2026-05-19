import sqlite3
import json
import yfinance as yf
import math
from datetime import datetime

db_path = "/home/shugo/weather.db"
js_path = "/home/shugo/my_website/data.js"

print("--- 🚀 出荷エンジン：最新市場指標（時価総額・PER・PBR）の一括積載開始 ---")

conn = sqlite3.connect(db_path)
cursor = conn.cursor()

cursor.execute("SELECT ticker, company_name, industry, COALESCE(currency,'JPY'), COALESCE(country,'JP'), COALESCE(type,'stock') FROM ticker_master;")
tickers = cursor.fetchall()

all_data = {}

for ticker, company_name, industry, currency, country, asset_type in tickers:
    print(f"[{asset_type.upper()}] {company_name} ({ticker}) [{currency}]...")
    
    # 📈 5年分の株価と最新の市場指標（info）のダウンロード
    market_cap = 0
    per = 0.0
    pbr = 0.0
    prices_json = []
    
    try:
        stock = yf.Ticker(ticker)
        hist = stock.history(period="5y") 
        for date, row in hist.iterrows():
            vol = row.get("Volume", 0)
            prices_json.append({
                "time": date.strftime("%Y-%m-%d"),
                "open": round(row["Open"], 2), "high": round(row["High"], 2),
                "low": round(row["Low"], 2), "close": round(row["Close"], 2),
                "volume": int(vol) if vol and not math.isnan(float(vol)) else 0,
            })
            
        # 💡 【新機能】yfinanceの深部から最新のPER、PBR、時価総額をダイレクトに抽出
        info = stock.info
        market_cap = info.get("marketCap", 0)
        # PERは実績(trailing)が無ければ予想(forward)をスマートに自動補完
        per = info.get("trailingPE") or info.get("forwardPE") or 0.0
        pbr = info.get("priceToBook", 0.0)
        
    except Exception as e:
        print(f"  ❌ yfinanceからの市場指標の取得に失敗: {e}")
        
    # 📊 過去すべての年度財務レコードを全セレクト
    cursor.execute("""
        SELECT fiscal_year, fiscal_period,
               current_assets, non_current_assets, current_liabilities, non_current_liabilities, net_assets,
               net_sales, operating_income, ordinary_income, income_before_taxes, net_income,
               operating_cf, investing_cf, financing_cf
        FROM financial_data_v2
        WHERE ticker = ? AND fiscal_period = 'FY'
        ORDER BY fiscal_year ASC;
    """, (ticker,))
    fin_rows = cursor.fetchall()
    
    financials_trend_json = {}
    for row in fin_rows:
        year = row[0]
        financials_trend_json[year] = {
            "year": row[0], "period": row[1],
            "current_assets": row[2], "non_current_assets": row[3],
            "current_liabilities": row[4], "non_current_liabilities": row[5], "net_assets": row[6],
            "net_sales": row[7], "operating_income": row[8], 
            "ordinary_income": row[9], "income_before_taxes": row[10], "net_income": row[11],
            "operating_cf": row[12], "investing_cf": row[13], "financing_cf": row[14]
        }
        
    all_data[ticker] = {
        "company_name": company_name,
        "industry": industry,
        "currency": currency,
        "country": country,
        "type": asset_type,
        "marketCap": market_cap,
        "per": per,
        "pbr": pbr,
        "prices": prices_json,
        "financials_trend": financials_trend_json
    }

conn.close()

updated_at = datetime.now().strftime("%Y-%m-%d %H:%M")
with open(js_path, "w", encoding="utf-8") as f:
    f.write(f"const DATA_UPDATED_AT = \"{updated_at}\";\n")
    f.write(f"const STOCK_DATA = {json.dumps(all_data, indent=2, ensure_ascii=False)};")

print("✨ PER・PBR・時価総額が完璧に同期された 'data.js' が出荷されました！")