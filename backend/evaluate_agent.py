import os
import pandas as pd
import numpy as np
from stable_baselines3 import PPO
from trading_env import CryptoTradingEnv

def evaluate():
    print("--- NEXUS AI: Performance Evaluation ---")
    
    # 1. Load the trained brain
    model_path = "backend/nexus_trading_agent_ppo.zip"
    if not os.path.exists(model_path): model_path = "nexus_trading_agent_ppo.zip"
    try:
        model = PPO.load(model_path)
        print(f"Successfully loaded brain: {model_path}")
    except Exception as e:
        print(f"Error loading model: {e}")
        return

    # 2. Load the data
    data_file = 'backend/historical_data.csv'
    if not os.path.exists(data_file): data_file = 'historical_data.csv'
    df = pd.read_csv(data_file)
    
    # 2. Centralized Feature Extraction
    from data_pipeline import get_features
    features_df = get_features(df)
    
    # Normalize
    features_df = (features_df - features_df.mean()) / features_df.std()
    
    # Re-attach close price
    features_df['close'] = df['close']
    
    # 3. Initialize Environment
    env = CryptoTradingEnv(features_df)
    obs, _ = env.reset()
    
    # 4. Run the simulation
    done = False
    total_trades = 0
    winning_trades = 0
    starting_balance = 10000
    last_net_worth = starting_balance

    print("Simulating trades on historical data...")
    
    while not done:
        action, _states = model.predict(obs, deterministic=True)
        obs, reward, terminated, truncated, info = env.step(action)
        
        # Track trades
        current_net_worth = info['net_worth']
        if action != 0: # If Buy or Sell action was taken
            total_trades += 1
            if current_net_worth > last_net_worth:
                winning_trades += 1
        
        last_net_worth = current_net_worth
        done = terminated or truncated

    # 5. Final Report
    final_net_worth = env.net_worth
    total_profit = final_net_worth - starting_balance
    profit_pct = (total_profit / starting_balance) * 100
    win_rate = (winning_trades / total_trades * 100) if total_trades > 0 else 0

    print("\n" + "="*30)
    print("FINAL BACKTEST REPORT")
    print("="*30)
    print(f"Initial Balance: ${starting_balance:,.2f}")
    print(f"Final Net Worth: ${final_net_worth:,.2f}")
    print(f"Total Profit:    ${total_profit:,.2f} ({profit_pct:.2f}%)")
    print(f"Total Trades:    {total_trades}")
    print(f"Win Rate:        {win_rate:.2f}%")
    print("="*30)

if __name__ == "__main__":
    evaluate()
