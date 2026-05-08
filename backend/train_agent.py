import os
import pandas as pd
from stable_baselines3 import PPO
from stable_baselines3.common.vec_env import DummyVecEnv
from trading_env import CryptoTradingEnv
from data_pipeline import fetch_historical_data, engineer_features

def main():
    print("Initializing RL Trading Agent...")
    
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
    
    # 2. Create Environment
    env = DummyVecEnv([lambda: CryptoTradingEnv(features_df)])
    
    # 3. Initialize Model
    # Faster learning rate to jump out of local minima
    model = PPO("MlpPolicy", env, verbose=1, learning_rate=0.001, n_steps=2048)
    
    # 4. Train Model
    print("Starting 24/7 Training Loop. Press Ctrl+C to stop.")
    try:
        # Fast initial run to establish model shape
        model.learn(total_timesteps=10_000)
        
        # Save the model
        model.save("nexus_trading_agent_ppo")
        print("Model saved successfully as nexus_trading_agent_ppo.zip")
    except KeyboardInterrupt:
        print("\nTraining interrupted manually. Saving current progress...")
        model.save("nexus_trading_agent_ppo_interrupted")

if __name__ == "__main__":
    main()
