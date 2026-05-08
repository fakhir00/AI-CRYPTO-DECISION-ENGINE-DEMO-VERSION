import os
import ccxt
import pandas as pd
import time
from data_pipeline import engineer_features

def fetch_historical_period(symbol='BTC/USDT', timeframe='1h', since_str='2025-10-01T00:00:00Z', until_str='2026-04-30T23:59:59Z'):
    """
    Fetches historical OHLCV data for a specific period, engineers features, and saves it.
    """
    print(f"Fetching data for {symbol} from {since_str} to {until_str}...")
    exchange = ccxt.binance()
    
    since = exchange.parse8601(since_str)
    until = exchange.parse8601(until_str)
    
    all_ohlcv = []
    current_since = since
    
    while current_since < until:
        try:
            print(f"Fetching from timestamp {current_since}...")
            ohlcv = exchange.fetch_ohlcv(symbol, timeframe, since=current_since, limit=1000)
            if not ohlcv:
                break
            
            all_ohlcv.extend(ohlcv)
            # update current_since to the last timestamp + 1 millisecond
            current_since = ohlcv[-1][0] + 1
            
            if current_since >= until:
                break
            time.sleep(0.5) # respect rate limit
        except Exception as e:
            print(f"Error fetching data: {e}")
            break

    # Filter out any data beyond the until timestamp
    all_ohlcv = [row for row in all_ohlcv if row[0] <= until]

    print(f"Fetched {len(all_ohlcv)} candles.")
    
    df = pd.DataFrame(all_ohlcv, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
    df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
    
    # 2. Add 5 Condition Signals (Institutional Alpha Proxies)
    print("Calculating Institutional Alpha signals...")
    
    # Volume Delta (Proxy for OBI)
    df['obi'] = (df['volume'] - df['volume'].rolling(window=20).mean()) / df['volume'].rolling(window=20).std()
    
    # Chaikin Money Flow (Proxy for Whale Flow)
    mfv = ((df['close'] - df['low']) - (df['high'] - df['close'])) / (df['high'] - df['low'].replace(0, 0.0001)) * df['volume']
    df['whale_flow'] = mfv.rolling(window=20).sum() / df['volume'].rolling(window=20).sum()
    
    # Bollinger Width (Proxy for Liquidation Density/Volatility)
    bb_high = df['close'].rolling(window=20).mean() + (df['close'].rolling(window=20).std() * 2)
    bb_low = df['close'].rolling(window=20).mean() - (df['close'].rolling(window=20).std() * 2)
    df['liq_heatmap_density'] = (bb_high - bb_low) / df['close'].rolling(window=20).mean()
    
    # Momentum ROC (Proxy for BTC Dominance/Market Power)
    df['btc_dominance'] = df['close'].pct_change(periods=24)
    
    # Stochastic RSI (Proxy for Funding Rate/Crowdedness)
    import ta
    df['funding_rate'] = ta.momentum.stochrsi(df['close'], window=14)

    df.dropna(inplace=True)
    
    # Engineer standardized features
    df = engineer_features(df)
    
    return df

if __name__ == "__main__":
    symbol = 'BTC/USDT'
    data_file = os.path.join(os.path.dirname(__file__), 'custom_backtest_data.csv')
    
    df = fetch_historical_period(symbol, '1h', '2025-10-01T00:00:00Z', '2026-05-01T00:00:00Z')
    df.to_csv(data_file, index=False)
    print(f"Data saved to {data_file}")
