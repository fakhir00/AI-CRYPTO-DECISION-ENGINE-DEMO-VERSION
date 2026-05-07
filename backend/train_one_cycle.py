import time
import os
import pandas as pd
from sb3_contrib import RecurrentPPO
from stable_baselines3.common.vec_env import DummyVecEnv
from trading_env import CryptoTradingEnv
from data_pipeline import fetch_historical_data, engineer_features, get_features

def run_one_cycle():
    print(f"\n--- Starting SINGLE Optimization Cycle at {time.strftime('%Y-%m-%d %H:%M:%S')} ---")
    
    # 1. Fetch Latest Data
    symbol = 'BTC/USDT'
    data_file = 'backend/historical_data.csv'
    if not os.path.exists(data_file): data_file = 'historical_data.csv'
    
    print("Fetching fresh market data...")
    df = fetch_historical_data(symbol, '1h', 2000)
    df = engineer_features(df)
    df.to_csv(data_file, index=False)
    
    # 2. Centralized Feature Extraction
    features_df = get_features(df)
    features_df = (features_df - features_df.mean()) / features_df.std()
    features_df['close'] = df['close']
    
    # 3. Create Environment
    env = DummyVecEnv([lambda: CryptoTradingEnv(features_df)])
    
    # 4. Load or Initialize Model
    model_path = "backend/nexus_trading_agent_ppo_v11"
    
    if os.path.exists(model_path + ".zip"):
        print(f"Loading existing brain for further optimization: {model_path}")
        model = RecurrentPPO.load(model_path, env=env, learning_rate=0.0007) 
    else:
        print("Initializing FRESH Deep Memory Oracle Brain (V11)...")
        model = RecurrentPPO("MlpLstmPolicy", env, verbose=1, learning_rate=0.0007)
    
    # 5. Train
    print(f"Agent is now learning (100,000 steps) for PURE ACCURACY optimization...")
    model.learn(total_timesteps=100_000)
    
    # 6. Save
    model.save("backend/nexus_trading_agent_ppo_v11")
    print(f"✅ Brain updated and saved. Performance optimized.")

if __name__ == "__main__":
    run_one_cycle()
