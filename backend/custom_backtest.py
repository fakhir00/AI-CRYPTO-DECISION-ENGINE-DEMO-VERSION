import os
import ccxt
import pandas as pd
import numpy as np
from datetime import datetime
import time
import sys

# Ensure backend is in path
sys.path.append(os.path.join(os.getcwd(), 'backend'))

import ta
from ta.momentum import RSIIndicator
from ta.trend import MACD, EMAIndicator
from ta.volatility import AverageTrueRange

from trading_env import CryptoTradingEnv
from sb3_contrib import RecurrentPPO
from data_pipeline import get_features, normalize_features

def fetch_data_range(symbol='BTC/USDT', timeframe='1h', start_date='2025-10-01', end_date='2026-05-01'):
    exchange = ccxt.binance()
    start_ts = int(datetime.strptime(start_date, '%Y-%m-%d').timestamp() * 1000)
    end_ts = int(datetime.strptime(end_date, '%Y-%m-%d').timestamp() * 1000)
    
    all_ohlcv = []
    current_ts = start_ts
    
    while current_ts < end_ts:
        print(f"Fetching from {datetime.fromtimestamp(current_ts/1000)}...")
        try:
            ohlcv = exchange.fetch_ohlcv(symbol, timeframe, since=current_ts, limit=1000)
            if not ohlcv:
                break
            all_ohlcv.extend(ohlcv)
            current_ts = ohlcv[-1][0] + (60 * 60 * 1000 if timeframe == '1h' else 24 * 60 * 60 * 1000)
            time.sleep(0.5)
        except Exception as e:
            print(f"Error fetching data: {e}")
            break
            
    df = pd.DataFrame(all_ohlcv, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
    df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
    df = df[df['timestamp'] < pd.to_datetime(end_date)]
    df.drop_duplicates(subset=['timestamp'], inplace=True)
    return df

def engineer_all_features(df):
    print("Calculating Institutional Alpha signals...")
    df['obi'] = (df['volume'] - df['volume'].rolling(window=20).mean()) / df['volume'].rolling(window=20).std()
    mfv = ((df['close'] - df['low']) - (df['high'] - df['close'])) / (df['high'] - df['low'] + 1e-8) * df['volume']
    df['whale_flow'] = mfv.rolling(window=20).sum() / (df['volume'].rolling(window=20).sum() + 1e-8)
    
    bb_mean = df['close'].rolling(window=20).mean()
    bb_std = df['close'].rolling(window=20).std()
    bb_high = bb_mean + (bb_std * 2)
    bb_low = bb_mean - (bb_std * 2)
    df['liq_heatmap_density'] = (bb_high - bb_low) / bb_mean
    
    df['btc_dominance'] = df['close'].pct_change(periods=24)
    df['funding_rate'] = ta.momentum.stochrsi(df['close'], window=14)
    
    print("Calculating technical indicators...")
    df['rsi'] = RSIIndicator(close=df['close'], window=14).rsi()
    macd = MACD(close=df['close'], window_slow=26, window_fast=12, window_sign=9)
    df['macd'] = macd.macd()
    df['macd_signal'] = macd.macd_signal()
    df['ema_9'] = EMAIndicator(close=df['close'], window=9).ema_indicator()
    df['ema_21'] = EMAIndicator(close=df['close'], window=21).ema_indicator()
    df['atr'] = AverageTrueRange(high=df['high'], low=df['low'], close=df['close'], window=14).average_true_range()
    
    df['pivot'] = (df['high'].shift(1) + df['low'].shift(1) + df['close'].shift(1)) / 3
    df['res1'] = 2 * df['pivot'] - df['low'].shift(1)
    df['sup1'] = 2 * df['pivot'] - df['high'].shift(1)
    df['local_res'] = df['high'].rolling(window=24).max()
    df['local_sup'] = df['low'].rolling(window=24).min()
    
    df.dropna(inplace=True)
    df.reset_index(drop=True, inplace=True)
    return df

def evaluate(df):
    model_path = "backend/nexus_trading_agent_ppo_v11.zip"
    if not os.path.exists(model_path): model_path = "nexus_trading_agent_ppo_v11.zip"
    try:
        model = RecurrentPPO.load(model_path)
    except Exception as e:
        print(f"Error loading model: {e}")
        return

    features_df = get_features(df)
    features_df = normalize_features(features_df, is_training=False)
    features_df['close'] = df['close']
    features_df['high'] = df['high']
    features_df['low'] = df['low']
    features_df['raw_atr'] = df['atr']
    features_df['raw_res1'] = df['res1']
    features_df['raw_sup1'] = df['sup1']
    features_df['raw_local_res'] = df['local_res']
    features_df['raw_local_sup'] = df['local_sup']
    features_df['raw_ema_9'] = df['ema_9']
    features_df['raw_ema_21'] = df['ema_21']
    
    env = CryptoTradingEnv(features_df)
    obs, _ = env.reset()
    
    done = False
    starting_balance = 10000.0
    env.balance = starting_balance
    env.initial_balance = starting_balance
    
    closed_trades = 0
    wins = 0
    losses = 0
    breakevens = 0
    win_profits = []
    loss_amounts = []
    
    correct_directions = 0
    total_steps = 0
    
    lstm_states = None
    episode_start = np.ones((1,), dtype=bool)
    
    while not done:
        action, lstm_states = model.predict(obs, state=lstm_states, episode_start=episode_start, deterministic=True)
        episode_start = np.zeros((1,), dtype=bool)
        
        prev_held = env.crypto_held
        row = env.df.iloc[env.current_step]
        next_row = env.df.iloc[env.current_step + 1] if env.current_step + 1 < len(env.df) else None
        
        if next_row is not None:
            total_steps += 1
            price_up = next_row['close'] > row['close']
            if (action == 1 and price_up) or (action == 2 and not price_up):
                correct_directions += 1
            elif action == 0 and abs(next_row['close'] - row['close']) / row['close'] < 0.001:
                correct_directions += 1
        
        if prev_held == 0 and action != 0:
            entry_net_worth = env.net_worth
            
        obs, reward, terminated, truncated, info = env.step(action)
        
        if info.get('trade_closed', False):
            closed_trades += 1
            trade_pnl_pct = info.get('trade_pnl_pct', 0)
            if trade_pnl_pct > 0.1:
                wins += 1
                win_profits.append(trade_pnl_pct)
            elif trade_pnl_pct < -0.1:
                losses += 1
                loss_amounts.append(trade_pnl_pct)
            else:
                breakevens += 1
                
        done = terminated or truncated

    final_net_worth = env.net_worth
    total_increase = ((final_net_worth - starting_balance) / starting_balance) * 100
    avg_win = np.mean(win_profits) if win_profits else 0
    avg_loss = np.mean(loss_amounts) if loss_amounts else 0
    dir_acc = (correct_directions / total_steps * 100) if total_steps > 0 else 0

    print("\n" + "="*40)
    print("      OCT 2025 - APR 2026 REPORT")
    print("="*40)
    print(f"Starting Balance:    ${starting_balance:,.2f}")
    print(f"Final Net Worth:     ${final_net_worth:,.2f}")
    print(f"Total Portfolio %:   {total_increase:+.2f}%")
    print("-" * 40)
    print(f"Total Trades:        {closed_trades}")
    print(f"Trade Win Rate:      {(wins/closed_trades*100):.2f}%" if closed_trades > 0 else "0.00%")
    print(f"DIRECTIONAL ACCURACY: {dir_acc:.2f}%")
    print("-" * 40)
    print(f"Successful Wins:     {wins} (Avg: {avg_win:+.2f}%)")
    print(f"Losses:              {losses} (Avg: {avg_loss:+.2f}%)")
    print(f"Break-evens:         {breakevens}")
    print("="*40)

if __name__ == '__main__':
    print("Starting Data Fetch...")
    df = fetch_data_range(symbol='BTC/USDT', timeframe='1h', start_date='2025-10-01', end_date='2026-05-01')
    print(f"Fetched {len(df)} 1-hour candles.")
    df = engineer_all_features(df)
    evaluate(df)
