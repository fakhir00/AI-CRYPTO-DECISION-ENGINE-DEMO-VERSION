import os
import pandas as pd
import numpy as np
from stable_baselines3 import PPO
from trading_env import CryptoTradingEnv
import sys

# Ensure backend is in path
sys.path.append(os.path.join(os.getcwd(), 'backend'))
from data_pipeline import get_features

def targeted_backtest(num_trades=100):
    print(f"--- NEXUS AI: Institutional Backtest (Target: {num_trades} Trades) ---")
    
    # 1. Load the trained brain
    model_path = "backend/nexus_trading_agent_ppo.zip"
    if not os.path.exists(model_path): model_path = "nexus_trading_agent_ppo.zip"
    
    try:
        model = PPO.load(model_path)
    except Exception as e:
        print(f"Error loading model: {e}")
        return

    # 2. Load the data
    data_file = 'backend/historical_data.csv'
    if not os.path.exists(data_file): data_file = 'historical_data.csv'
    df = pd.read_csv(data_file)
    
    # 3. Extract Features
    features_df = get_features(df)
    features_df = (features_df - features_df.mean()) / features_df.std()
    features_df['close'] = df['close']
    
    # 4. Initialize Environment
    env = CryptoTradingEnv(features_df)
    obs, _ = env.reset()
    
    # 5. Run the targeted simulation
    done = False
    trades_executed = 0
    winning_trades = 0
    losing_trades = 0
    starting_balance = 10000
    balance_history = [starting_balance]
    
    print(f"Scanning market data for trade opportunities...")
    
    while not done and trades_executed < num_trades:
        action, _states = model.predict(obs, deterministic=True)
        
        # Track state before step
        prev_net_worth = env.net_worth
        prev_held = env.crypto_held
        
        obs, reward, terminated, truncated, info = env.step(action)
        
        # Detect a CLOSED trade
        # In this env, if crypto_held goes from >0 to 0, a trade was closed.
        if prev_held > 0 and env.crypto_held == 0:
            trades_executed += 1
            if env.net_worth > prev_net_worth:
                winning_trades += 1
            else:
                losing_trades += 1
            balance_history.append(env.net_worth)
            
        done = terminated or truncated

    # 6. Final Report
    final_net_worth = env.net_worth
    total_profit = final_net_worth - starting_balance
    profit_pct = (total_profit / starting_balance) * 100
    win_rate = (winning_trades / trades_executed * 100) if trades_executed > 0 else 0

    print("\n" + "="*40)
    print("      NEXUS INSTITUTIONAL REPORT")
    print("="*40)
    print(f"Status:           BACKTEST COMPLETE")
    print(f"Sample Size:      {trades_executed} Trades")
    print(f"Initial Capital:  ${starting_balance:,.2f}")
    print(f"Final Capital:    ${final_net_worth:,.2f}")
    print("-" * 40)
    print(f"Total Profit:     ${total_profit:,.2f}")
    print(f"Return on Cap:    {profit_pct:.2f}%")
    print(f"Win Percentage:   {win_rate:.2f}%")
    print(f"Profit Factor:    {winning_trades / losing_trades if losing_trades > 0 else '∞'}")
    print("="*40)

if __name__ == "__main__":
    targeted_backtest(100)
