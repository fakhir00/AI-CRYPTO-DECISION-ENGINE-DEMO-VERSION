import os
import time
import pandas as pd
import numpy as np
import ccxt
from stable_baselines3.common.vec_env import DummyVecEnv
from sb3_contrib import RecurrentPPO
from trading_env import CryptoTradingEnv
from data_pipeline import fetch_historical_data, get_features, normalize_features, calculate_institutional_features

def run_training_cycle():
    print(f"\n--- Starting Training Cycle at {time.strftime('%Y-%m-%d %H:%M:%S')} ---")
    
    # 1. Fetch Latest Data + Engineer Features (Consolidated)
    symbol = 'BTC/USDT'
    data_file = 'backend/historical_data.csv'
    if not os.path.exists(data_file): data_file = 'historical_data.csv'
    
    print(f"Fetching fresh market data...")
    # Using 5,000 candles for a good balance of speed and depth
    df = fetch_historical_data(symbol, '1h', 5000)
    df.to_csv(data_file, index=False)
    
    # 2. Centralized Feature Extraction
    features_df = get_features(df)
    
    # Normalize
    features_df = normalize_features(features_df, is_training=True)
    
    # Re-attach price columns needed for environment logic (raw_*)
    # IMPORTANT: We include 'close' to match the v11 shape (18 total features in obs)
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
    model_name = "nexus_v17_conviction"
    model_path = f"backend/{model_name}"
    
    # Increase ent_coef to force the AI to make a choice (reduce uncertainty)
    print("Launching v17 'CONVICTION' brain...")
    model = RecurrentPPO("MlpLstmPolicy", env, verbose=1, learning_rate=1e-4, ent_coef=0.05)
    
    # 5. Train with Checkpoints
    from stable_baselines3.common.callbacks import CheckpointCallback
    checkpoint_callback = CheckpointCallback(
        save_freq=10000,
        save_path='backend/checkpoints/',
        name_prefix=model_name
    )
    
    print(f"Agent is now in EMERGENCY PROFITABILITY MODE...")
    model.learn(total_timesteps=250_000, callback=checkpoint_callback) 
    
    # Also save to the main path
    model.save(model_path)
    print(f"✅ Brain updated and saved. Performance optimized.")

if __name__ == "__main__":
    print("NEXUS 24/7 AUTONOMOUS TRAINING ENGINE STARTED")
    print("This script will continuously optimize the trading brain.")
    
    while True:
        try:
            run_training_cycle()
            print("Cooling down for 1 hour before next optimization cycle...")
            time.sleep(3600)
        except Exception as e:
            print(f"❌ Training cycle failed: {e}")
            import traceback
            traceback.print_exc()
            time.sleep(60)
