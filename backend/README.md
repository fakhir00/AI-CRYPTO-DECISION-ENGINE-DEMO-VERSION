# Nexus Autonomous ML Trading Agent

This directory contains the Python architecture for an authentic Reinforcement Learning (RL) crypto trading bot, built using `stable-baselines3`, `gymnasium`, and `pandas-ta`.

## Setup Instructions

1. **Install Python 3.9+** (if not already installed).
2. **Install Dependencies:**
   ```bash
   cd backend
   pip install -r requirements.txt
   ```
3. **Run the 24/7 Training Loop:**
   ```bash
   python train_agent.py
   ```

## Architecture Overview

- **`data_pipeline.py`**: Fetches historical Binance OHLCV data and calculates technical indicators (RSI, MACD, EMAs) to serve as "features" for the model.
- **`trading_env.py`**: A custom OpenAI Gym (`gymnasium`) environment that simulates trading with a $10,000 starting balance and tracks PnL as the reward.
- **`train_agent.py`**: Initializes the PPO neural network and begins thousands of simulated epochs of training.

*Disclaimer: This is for educational and paper-trading purposes. Do not connect real exchange keys until the model demonstrates sustained edge on unseen data.*
