import os
import pandas as pd
import numpy as np
from stable_baselines3 import PPO
from trading_env import CryptoTradingEnv
import sys

# Ensure backend is in path
sys.path.append(os.path.join(os.getcwd(), 'backend'))
from data_pipeline import get_features

def run_walk_forward_backtest():
    print(f"--- NEXUS AI: Walk-Forward Backtest (Oct 2025 - Apr 2026) ---")
    
    # 1. Load the trained brain
    model_path = os.path.join(os.path.dirname(__file__), "nexus_trading_agent_ppo_v11.zip")
    if not os.path.exists(model_path): 
        print(f"Model v11 not found at {model_path}. Trying fallback.")
        model_path = os.path.join(os.path.dirname(__file__), "nexus_trading_agent_ppo.zip")
    
    try:
        model = PPO.load(model_path)
    except Exception as e:
        print(f"Error loading model: {e}")
        return

    # 2. Load the custom data
    data_file = os.path.join(os.path.dirname(__file__), 'custom_backtest_data.csv')
    if not os.path.exists(data_file): 
        print(f"Data file not found at {data_file}. Please run fetch_custom_data.py first.")
        return
    df = pd.read_csv(data_file)
    
    # 3. Extract Features
    features_df = get_features(df)
    features_df = (features_df - features_df.mean()) / features_df.std()
    features_df['close'] = df['close']
    
    # 4. Initialize Environment
    env = CryptoTradingEnv(features_df)
    obs, _ = env.reset()
    
    # 5. Run the targeted simulation step by step
    done = False
    trades_executed = 0
    winning_trades = 0
    losing_trades = 0
    starting_balance = 10000
    
    print(f"Initializing walk-forward evaluation on {len(df)} 1H candles...")
    
    while not done:
        # Agent observes state up to today and predicts next action
        action, _states = model.predict(obs, deterministic=True)
        
        # Track state before step
        prev_net_worth = env.net_worth
        prev_held = env.crypto_held
        
        obs, reward, terminated, truncated, info = env.step(action)
        
        # Detect a CLOSED trade
        if prev_held > 0 and env.crypto_held == 0:
            trades_executed += 1
            if env.net_worth > prev_net_worth:
                winning_trades += 1
            else:
                losing_trades += 1
            
        done = terminated or truncated

    # 6. Final Report
    final_net_worth = env.net_worth
    total_profit = final_net_worth - starting_balance
    profit_pct = (total_profit / starting_balance) * 100
    win_rate = (winning_trades / trades_executed * 100) if trades_executed > 0 else 0

    print("\n" + "="*50)
    print("      NEXUS WALK-FORWARD ACCURACY REPORT")
    print("           (Oct 2025 - Apr 2026)")
    print("="*50)
    print(f"Total Candles Tested: {len(df)} Hours")
    print(f"Trades Executed:      {trades_executed} Trades")
    print(f"Winning Trades:       {winning_trades}")
    print(f"Losing Trades:        {losing_trades}")
    print(f"Signal Accuracy:      {win_rate:.2f}%")
    print("-" * 50)
    print(f"Initial Capital:      ${starting_balance:,.2f}")
    print(f"Final Capital:        ${final_net_worth:,.2f}")
    print(f"Total Net Profit:     ${total_profit:,.2f} ({profit_pct:.2f}%)")
    print(f"Profit Factor:        {winning_trades / losing_trades if losing_trades > 0 else '∞'}")
    print("="*50)

if __name__ == "__main__":
    run_walk_forward_backtest()
