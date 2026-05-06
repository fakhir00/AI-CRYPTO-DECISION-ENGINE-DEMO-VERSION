import os
import pandas as pd
import numpy as np
from stable_baselines3 import PPO
from trading_env import CryptoTradingEnv
from data_pipeline import get_features

def rigorous_test():
    print("--- NEXUS AI: RIGOROUS PERFORMANCE ANALYSIS ---")
    
    # 1. Load Model
    model_path = "backend/nexus_trading_agent_ppo.zip"
    if not os.path.exists(model_path): model_path = "nexus_trading_agent_ppo.zip"
    try:
        model = PPO.load(model_path)
    except Exception as e:
        print(f"Error: {e}")
        return

    # 2. Load Data
    data_file = 'backend/historical_data.csv'
    if not os.path.exists(data_file): data_file = 'historical_data.csv'
    df = pd.read_csv(data_file)
    
    features_df = get_features(df)
    features_df = (features_df - features_df.mean()) / features_df.std()
    features_df['close'] = df['close']
    
    # 3. Environment
    env = CryptoTradingEnv(features_df)
    obs, _ = env.reset()
    
    # 4. Simulation with Logging
    trades = []
    done = False
    
    print("Executing rigorous market scan...")
    
    while not done:
        current_idx = env.current_step
        if current_idx >= len(df) - 1: break
        
        # Use deterministic predictions for final performance analysis
        action, _states = model.predict(obs, deterministic=True)
        
        prev_held = env.crypto_held
        prev_net_worth = env.net_worth
        
        # Capture state before action
        state_data = df.iloc[current_idx].to_dict()
        
        obs, reward, terminated, truncated, info = env.step(action)
        
        # Detect Trade Entry
        if prev_held == 0 and env.crypto_held > 0:
            trades.append({
                'type': 'ENTRY',
                'direction': 'LONG' if action == 1 else 'SHORT',
                'price': state_data['close'],
                'step': current_idx,
                'rsi': state_data.get('rsi'),
                'macd': state_data.get('macd'),
                'atr': state_data.get('atr'),
                'obi': state_data.get('obi'),
                'funding': state_data.get('funding_rate'),
                'whale_flow': state_data.get('whale_flow')
            })
            
        # Detect Trade Exit
        if prev_held > 0 and env.crypto_held == 0:
            profit = env.net_worth - prev_net_worth
            trades[-1]['exit_price'] = state_data['close']
            trades[-1]['profit'] = profit
            trades[-1]['result'] = 'WIN' if profit > 0 else 'LOSS'
            trades[-1]['duration'] = current_idx - trades[-1]['step']

        done = terminated or truncated

    # 5. Save Analysis
    analysis_df = pd.DataFrame([t for t in trades if 'result' in t])
    analysis_df.to_csv('backend/trade_analysis.csv', index=False)
    
    if len(analysis_df) == 0:
        print("RESULT: No trades were executed in this window. Agent is extremely risk-averse.")
        return

    # 6. Basic Statistics
    wins = analysis_df[analysis_df['result'] == 'WIN']
    losses = analysis_df[analysis_df['result'] == 'LOSS']
    
    print(f"\n--- ANALYSIS SUMMARY ({len(analysis_df)} Trades) ---")
    print(f"Win Rate: {len(wins)/len(analysis_df)*100:.2f}%")
    print(f"Avg Profit (Wins): ${wins['profit'].mean():.2f}")
    print(f"Avg Loss (Losses): ${losses['profit'].mean():.2f}")
    
    print("\n--- WINNING PATTERNS ---")
    print(wins[['rsi', 'macd', 'atr', 'obi']].mean())
    
    print("\n--- LOSING PATTERNS ---")
    print(losses[['rsi', 'macd', 'atr', 'obi']].mean())
    
    print(f"\nDetailed analysis saved to backend/trade_analysis.csv")

if __name__ == "__main__":
    rigorous_test()
