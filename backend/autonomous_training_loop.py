import time
import os
import pandas as pd
from stable_baselines3 import PPO
from stable_baselines3.common.vec_env import DummyVecEnv
from trading_env import CryptoTradingEnv
from data_pipeline import fetch_historical_data, engineer_features

def run_training_cycle():
    print(f"\n--- Starting Training Cycle at {time.strftime('%Y-%m-%d %H:%M:%S')} ---")
    
    # 1. Fetch Latest Data
    symbol = 'BTC/USDT'
    data_file = 'backend/historical_data.csv'
    if not os.path.exists(data_file): data_file = 'historical_data.csv'
    
    print("Fetching fresh market data...")
    df = fetch_historical_data(symbol, '1h', 2000)
    df = engineer_features(df)
    df.to_csv(data_file, index=False)
    
    # 2. Centralized Feature Extraction
    from data_pipeline import get_features, normalize_features
    features_df = get_features(df)
    
    # Normalize
    features_df = normalize_features(features_df, is_training=True)
    
    # Re-attach price columns
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
    
    # 3. Create Environment
    env = DummyVecEnv([lambda: CryptoTradingEnv(features_df)])
    
    # 4. Load or Initialize Model
    model_path = "nexus_trading_agent_ppo"
    if os.path.exists(model_path + ".zip"):
        print("Loading existing brain for further optimization...")
        model = PPO.load(model_path, env=env)
    else:
        print("Initializing new PPO brain...")
        model = PPO("MlpPolicy", env, verbose=1, learning_rate=0.0005) # Lower LR for fine-tuning
    
    # 5. Train
    print(f"Agent is now learning from latest patterns (Deep Optimization Mode)...")
    model.learn(total_timesteps=150_000) # Increased for higher accuracy
    
    # 6. Save
    model.save(model_path)
    print(f"✅ Brain updated and saved. Performance optimized.")

if __name__ == "__main__":
    print("NEXUS 24/7 AUTONOMOUS TRAINING ENGINE STARTED")
    print("This script will continuously optimize the trading brain.")
    
    while True:
        try:
            run_training_cycle()
            print("Cooling down for 1 hour before next optimization cycle...")
            time.sleep(3600) # Wait 1 hour between training cycles
        except Exception as e:
            print(f"❌ Training cycle failed: {e}")
            time.sleep(60) # Wait a minute before retrying
