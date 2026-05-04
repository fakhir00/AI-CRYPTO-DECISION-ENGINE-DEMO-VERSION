import os
import pandas as pd
from stable_baselines3 import PPO
from stable_baselines3.common.vec_env import DummyVecEnv
from trading_env import CryptoTradingEnv
from data_pipeline import fetch_historical_data, engineer_features

def main():
    print("Initializing RL Trading Agent...")
    
    # 1. Fetch Data
    data_file = 'historical_data.csv'
    if not os.path.exists(data_file):
        df = fetch_historical_data('BTC/USDT', '1h', 2000)
        df = engineer_features(df)
        df.to_csv(data_file)
    else:
        df = pd.read_csv(data_file, index_col='timestamp', parse_dates=True)
    
    # Clean data to pass to env
    # Dropping non-numeric or highly varying raw columns to help the model learn
    features_df = df.drop(columns=['open', 'high', 'low', 'close', 'volume']).copy()
    # Normalize features roughly
    features_df = (features_df - features_df.mean()) / features_df.std()
    # Re-attach close price for the environment to calculate PnL
    features_df['close'] = df['close']
    
    # 2. Create Environment
    env = DummyVecEnv([lambda: CryptoTradingEnv(features_df)])
    
    # 3. Initialize Model
    # PPO is robust and standard for RL environments
    model = PPO("MlpPolicy", env, verbose=1, learning_rate=0.0003, n_steps=2048)
    
    # 4. Train Model
    print("Starting 24/7 Training Loop. Press Ctrl+C to stop.")
    try:
        # Train for a set number of timesteps. In reality, you'd loop this continuously
        # or train on huge rolling datasets.
        model.learn(total_timesteps=100_000)
        
        # Save the model
        model.save("nexus_trading_agent_ppo")
        print("Model saved successfully as nexus_trading_agent_ppo.zip")
    except KeyboardInterrupt:
        print("\nTraining interrupted manually. Saving current progress...")
        model.save("nexus_trading_agent_ppo_interrupted")

if __name__ == "__main__":
    main()
