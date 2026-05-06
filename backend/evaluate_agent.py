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
    starting_balance = 100.0
    env.balance = starting_balance
    env.initial_balance = starting_balance
    
    closed_trades = 0
    wins = 0
    losses = 0
    breakevens = 0
    
    win_profits = []
    loss_amounts = []
    
    print(f"Simulating $100 Portfolio Growth...")
    
    while not done:
        action, _states = model.predict(obs, deterministic=True)
        
        # Track state before step
        prev_held = env.crypto_held
        
        if prev_held == 0 and action != 0:
            entry_net_worth = env.net_worth
        
        obs, reward, terminated, truncated, info = env.step(action)
        
        # Detect a CLOSED trade
        if prev_held > 0 and env.crypto_held == 0:
            closed_trades += 1
            final_net_worth = env.net_worth
            trade_pnl_pct = ((final_net_worth - entry_net_worth) / entry_net_worth) * 100
            
            if trade_pnl_pct > 0.1: # Profitable
                wins += 1
                win_profits.append(trade_pnl_pct)
            elif trade_pnl_pct < -0.1: # Loss
                losses += 1
                loss_amounts.append(trade_pnl_pct)
            else: # Breakeven
                breakevens += 1
        
        done = terminated or truncated

    # 5. Final Granular Report
    final_net_worth = env.net_worth
    total_increase = ((final_net_worth - starting_balance) / starting_balance) * 100
    avg_win = np.mean(win_profits) if win_profits else 0
    avg_loss = np.mean(loss_amounts) if loss_amounts else 0

    print("\n" + "="*40)
    print("      $100 PORTFOLIO IMPACT REPORT")
    print("="*40)
    print(f"Starting Balance:    ${starting_balance:,.2f}")
    print(f"Final Net Worth:     ${final_net_worth:,.2f}")
    print(f"Total Portfolio %:   {total_increase:+.2f}%")
    print("-" * 40)
    print(f"Total Trades:        {closed_trades}")
    print(f"Successful Wins:     {wins} (Avg: {avg_win:+.2f}%)")
    print(f"Losses:              {losses} (Avg: {avg_loss:+.2f}%)")
    print(f"Break-evens:         {breakevens}")
    print("-" * 40)
    print(f"OVERALL WIN RATE:    {(wins/closed_trades*100):.2f}%" if closed_trades > 0 else "0.00%")
    print("="*40)

if __name__ == "__main__":
    evaluate()
