import os
import ccxt
import pandas as pd
import numpy as np
import json
import ta
import time

def calculate_institutional_features(df):
    """
    Centralized function to calculate all technical and institutional indicators.
    Ensures consistency between training and inference.
    """
    # 1. Basic Technical Indicators
    df['rsi'] = ta.momentum.rsi(df['close'], window=14)
    macd = ta.trend.MACD(close=df['close'], window_slow=26, window_fast=12, window_sign=9)
    df['macd'] = macd.macd()
    df['macd_signal'] = macd.macd_signal()
    df['ema_9'] = ta.trend.ema_indicator(df['close'], window=9)
    df['ema_21'] = ta.trend.ema_indicator(df['close'], window=21)
    
    # ATR - Setting window to 7 as per institutional requirement
    df['atr'] = ta.volatility.average_true_range(df['high'], df['low'], df['close'], window=7)
    
    # 2. Institutional Alpha Proxies
    # Volume Delta (Proxy for OBI)
    df['obi'] = (df['volume'] - df['volume'].rolling(window=20).mean()) / df['volume'].rolling(window=20).std()
    
    # Chaikin Money Flow (Proxy for Whale Flow)
    mfv = ((df['close'] - df['low']) - (df['high'] - df['close'])) / (df['high'] - df['low']) * df['volume']
    df['whale_flow'] = mfv.rolling(window=20).sum() / df['volume'].rolling(window=20).sum()
    
    # Bollinger Width (Proxy for Volatility)
    bb_high = df['close'].rolling(window=20).mean() + (df['close'].rolling(window=20).std() * 2)
    bb_low = df['close'].rolling(window=20).mean() - (df['close'].rolling(window=20).std() * 2)
    df['liq_heatmap_density'] = (bb_high - bb_low) / df['close'].rolling(window=20).mean()
    
    # Momentum ROC (Proxy for Market Power)
    df['btc_dominance'] = df['close'].pct_change(periods=24)
    
    # Funding Rate Proxy (StochRSI)
    df['funding_rate'] = ta.momentum.stochrsi(df['close'], window=14)

    # 3. Support and Resistance (Pivot Points)
    df['pivot'] = (df['high'].shift(1) + df['low'].shift(1) + df['close'].shift(1)) / 3
    df['res1'] = 2 * df['pivot'] - df['low'].shift(1)
    df['sup1'] = 2 * df['pivot'] - df['high'].shift(1)
    df['local_res'] = df['high'].rolling(window=24).max()
    df['local_sup'] = df['low'].rolling(window=24).min()

    # 5. Volume Dynamics (Smart Money Tracking)
    df['obv'] = ta.volume.on_balance_volume(df['close'], df['volume'])
    df['force_index'] = (df['close'] - df['close'].shift(1)) * df['volume']
    
    df.dropna(inplace=True)
    return df

def fetch_historical_data(symbol='BTC/USDT', timeframe='1h', limit=1000):
    """
    Fetches historical OHLCV data and calculates features.
    """
    print(f"Fetching {limit} candles for {symbol}...")
    exchange = ccxt.binance()
    
    if limit <= 1000:
        ohlcv = exchange.fetch_ohlcv(symbol, timeframe, limit=limit)
    else:
        all_ohlcv = []
        limit_per_call = 1000
        ms_per_hour = 60 * 60 * 1000
        since = int(time.time() * 1000) - (limit * ms_per_hour)
        
        while len(all_ohlcv) < limit:
            batch = exchange.fetch_ohlcv(symbol, timeframe, since=since, limit=limit_per_call)
            if not batch: break
            all_ohlcv.extend(batch)
            since = batch[-1][0] + ms_per_hour
            time.sleep(0.1)
        ohlcv = all_ohlcv[-limit:]
    
    df = pd.DataFrame(ohlcv, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
    df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
    
    return calculate_institutional_features(df)

def engineer_features(df):
    """Legacy wrapper for consistency."""
    return calculate_institutional_features(df)

def get_features(df):
    """
    Standardizes the feature set used by the RL agent.
    Returns only the numeric features for the observation space.
    """
    feature_cols = [
        'rsi', 'macd', 'macd_signal', 'ema_9', 'ema_21', 'atr',
        'obi', 'funding_rate', 'whale_flow', 'btc_dominance', 'liq_heatmap_density',
        'res1', 'sup1', 'local_res', 'local_sup', 'obv', 'force_index'
    ]
    # Ensure all columns exist
    for col in feature_cols:
        if col not in df.columns:
            df[col] = 0.0
            
    return df[feature_cols].copy()

def normalize_features(df, is_training=True):
    """
    Normalizes features and saves/loads the scaler to prevent data leakage.
    """
    scaler_path = os.path.join(os.path.dirname(__file__), 'scaler.json')
    
    if is_training:
        mean_s = df.mean()
        std_s = df.std()
        with open(scaler_path, 'w') as f:
            json.dump({'mean': mean_s.to_dict(), 'std': std_s.to_dict()}, f)
        mean, std = mean_s, std_s
    else:
        if not os.path.exists(scaler_path):
            return df
        with open(scaler_path, 'r') as f:
            scaler = json.load(f)
        mean = pd.Series(scaler['mean'])
        std = pd.Series(scaler['std'])
        
    return (df - mean) / std.replace(0, 1)
