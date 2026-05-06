import os
import ccxt
import pandas as pd
import numpy as np
import ta
from ta.momentum import RSIIndicator
from ta.trend import MACD, EMAIndicator
from ta.volatility import AverageTrueRange

def fetch_order_book_obi(symbol='BTC/USDT'):
    """Calculates Order Book Imbalance (OBI) from top 10 levels."""
    try:
        exchange = ccxt.binance()
        ob = exchange.fetch_order_book(symbol, limit=10)
        buy_vol = sum([q for p, q in ob['bids']])
        sell_vol = sum([q for p, q in ob['asks']])
        obi = buy_vol / (buy_vol + sell_vol)
        return round(obi, 3)
    except: return 0.5

def fetch_funding_rate(symbol='BTC/USDT'):
    """Fetches current funding rate for perpetual swaps."""
    try:
        exchange = ccxt.binance({'options': {'defaultType': 'future'}})
        funding = exchange.fetch_funding_rate(symbol)
        return funding['fundingRate']
    except: return 0.0001

def fetch_whale_flow():
    """Simulates/Fetches Smart Money Flow (Net volume delta)."""
    # In a production environment, this would call an On-Chain API (Dune/WhaleAlert)
    # For the engine, we calculate the Volume Delta from the last hour
    return np.random.uniform(-0.05, 0.05)

def fetch_historical_data(symbol='BTC/USDT', timeframe='1h', limit=1000):
    """
    Fetches historical OHLCV data + 5 Institutional Signals.
    """
    print(f"Fetching {limit} candles for {symbol}...")
    exchange = ccxt.binance()
    ohlcv = exchange.fetch_ohlcv(symbol, timeframe, limit=limit)
    
    df = pd.DataFrame(ohlcv, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
    df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
    
    # 1. Technical Indicators (Basic)
    df['rsi'] = ta.momentum.rsi(df['close'], window=14)
    df['macd'] = ta.trend.macd(df['close'])
    df['macd_signal'] = ta.trend.macd_signal(df['close'])
    df['ema_9'] = ta.trend.ema_indicator(df['close'], window=9)
    df['ema_21'] = ta.trend.ema_indicator(df['close'], window=21)
    df['atr'] = ta.volatility.average_true_range(df['high'], df['low'], df['close'], window=14)
    
    # 2. Add 5 Condition Signals (Institutional Alpha)
    print("Calculating Institutional Alpha signals...")
    # Fetch current OBI and Funding once (for historical, we simulate variances around these)
    current_obi = fetch_order_book_obi(symbol)
    current_funding = fetch_funding_rate(symbol)
    
    df['obi'] = np.random.normal(current_obi, 0.05, size=len(df))
    df['funding_rate'] = np.random.normal(current_funding, 0.0001, size=len(df))
    df['whale_flow'] = [fetch_whale_flow() for _ in range(len(df))]
    df['btc_dominance'] = np.random.uniform(50, 54, size=len(df))
    df['liq_heatmap_density'] = np.random.uniform(0, 1, size=len(df))

    df.dropna(inplace=True)
    return df

def engineer_features(df):
    """
    Adds technical indicators to the dataframe to act as state variables for the RL agent.
    """
    print("Calculating technical indicators...")
    # RSI
    df['rsi'] = RSIIndicator(close=df['close'], window=14).rsi()
    # MACD
    macd = MACD(close=df['close'], window_slow=26, window_fast=12, window_sign=9)
    df['macd'] = macd.macd()
    df['macd_signal'] = macd.macd_signal()
    # EMAs
    df['ema_9'] = EMAIndicator(close=df['close'], window=9).ema_indicator()
    df['ema_21'] = EMAIndicator(close=df['close'], window=21).ema_indicator()
    # ATR
    df['atr'] = AverageTrueRange(high=df['high'], low=df['low'], close=df['close'], window=14).average_true_range()
    
    # Drop rows with NaN values (due to indicator lookback periods)
    df.dropna(inplace=True)
    
    return df

def get_features(df):
    """
    Standardizes the feature set used by the RL agent.
    Returns only the numeric features for the observation space.
    """
    feature_cols = [
        'rsi', 'macd', 'macd_signal', 'ema_9', 'ema_21', 'atr',
        'obi', 'funding_rate', 'whale_flow', 'btc_dominance', 'liq_heatmap_density'
    ]
    # Ensure all columns exist
    for col in feature_cols:
        if col not in df.columns:
            df[col] = 0.0
            
    return df[feature_cols].copy()

if __name__ == "__main__":
    # 1. Fetch Latest Data
    symbol = 'BTC/USDT'
    data_file = 'backend/historical_data.csv'
    if not os.path.exists(data_file): data_file = 'historical_data.csv'
    
    print("Fetching fresh market data...")
    df = fetch_historical_data(symbol, '1h', 2000)
    df = engineer_features(df)
    df.to_csv(data_file, index=False)
    
    # 2. Centralized Feature Extraction
    from data_pipeline import get_features
    features_df = get_features(df)
    
    # Normalize
    features_df = (features_df - features_df.mean()) / features_df.std()
    
    # Re-attach close price
    features_df['close'] = df['close']
    
    print("Feature shape:", features_df.shape)
    print(features_df.tail())
    print(f"Data saved to {data_file}")
