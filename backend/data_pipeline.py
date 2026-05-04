import ccxt
import pandas as pd
from ta.momentum import RSIIndicator
from ta.trend import MACD, EMAIndicator
from ta.volatility import AverageTrueRange

def fetch_historical_data(symbol='BTC/USDT', timeframe='1h', limit=1000):
    """
    Fetches historical OHLCV data from Binance using CCXT.
    """
    print(f"Fetching {limit} candles of {timeframe} data for {symbol}...")
    exchange = ccxt.binance()
    ohlcv = exchange.fetch_ohlcv(symbol, timeframe, limit=limit)
    
    df = pd.DataFrame(ohlcv, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
    df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
    df.set_index('timestamp', inplace=True)
    
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

if __name__ == "__main__":
    df = fetch_historical_data()
    df = engineer_features(df)
    print(df.tail())
    df.to_csv("historical_data.csv")
    print("Data saved to historical_data.csv")
