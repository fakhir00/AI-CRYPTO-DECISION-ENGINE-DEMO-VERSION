import os
import json
import pandas as pd
import numpy as np
import ccxt
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from stable_baselines3 import PPO
from data_pipeline import engineer_features, fetch_order_book_obi, fetch_funding_rate, fetch_whale_flow
from typing import List, Optional

app = FastAPI(title="NEXUS AI Trading Engine API")

# Load model
MODEL_PATH = "backend/nexus_trading_agent_ppo.zip"
if not os.path.exists(MODEL_PATH):
    # Fallback if run from backend/ directory
    MODEL_PATH = "nexus_trading_agent_ppo.zip"

model = None
try:
    model = PPO.load(MODEL_PATH)
    print(f"✅ Model loaded from {MODEL_PATH}")
except Exception as e:
    print(f"❌ Error loading model: {e}")

# Load or calculate normalization stats
def get_normalization_stats():
    csv_path = 'backend/historical_data.csv'
    if not os.path.exists(csv_path):
        csv_path = 'historical_data.csv'
    
    if os.path.exists(csv_path):
        df = pd.read_csv(csv_path, index_col='timestamp', parse_dates=True)
        features_df = df.drop(columns=['open', 'high', 'low', 'close', 'volume']).copy()
        return features_df.mean().to_dict(), features_df.std().to_dict()
    return {}, {}

MEAN_STATS, STD_STATS = get_normalization_stats()

class PredictionRequest(BaseModel):
    symbol: str = "BTC/USDT"
    timeframe: str = "1h"

class PredictionResponse(BaseModel):
    symbol: str
    action: int  # 0: Hold, 1: Buy, 2: Sell
    action_label: str
    confidence: float
    price: float
    timestamp: str

@app.get("/")
async def root():
    return {"status": "online", "engine": "NEXUS PPO v1.0"}

@app.post("/predict", response_model=PredictionResponse)
async def predict(request: PredictionRequest):
    if model is None:
        raise HTTPException(status_code=500, detail="Model not loaded")

    try:
        # 1. Fetch latest data
        exchange = ccxt.binance()
        ohlcv = exchange.fetch_ohlcv(request.symbol, request.timeframe, limit=50)
        df = pd.DataFrame(ohlcv, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
        df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
        
        # 2. Engineer features
        df = engineer_features(df)
        
        # 3. Add Institutional Alpha (Latest)
        df['obi'] = fetch_order_book_obi(request.symbol)
        df['funding_rate'] = fetch_funding_rate(request.symbol)
        df['whale_flow'] = fetch_whale_flow()
        df['btc_dominance'] = 52.5 # Mock or fetch
        df['liq_heatmap_density'] = 0.5 # Mock or fetch
        
        # 4. Get the last row
        latest_row = df.iloc[-1].copy()
        current_price = latest_row['close']
        
        # 5. Prepare features for model
        # Remove raw price/vol columns
        features = latest_row.drop(['timestamp', 'open', 'high', 'low', 'close', 'volume']).to_dict()
        
        # Normalize
        norm_features = []
        for col, val in features.items():
            mean = MEAN_STATS.get(col, 0)
            std = STD_STATS.get(col, 1)
            norm_features.append((val - mean) / std)
            
        # Add balance and crypto_held (mocked for inference)
        # In a real scenario, this would be the actual account state
        norm_features.extend([10000.0, 0.0]) # balance, crypto_held
        
        obs = np.array(norm_features, dtype=np.float32)
        
        # 6. Predict
        action, _states = model.predict(obs, deterministic=True)
        
        labels = ["HOLD", "BUY (LONG)", "SELL (SHORT)"]
        
        return {
            "symbol": request.symbol,
            "action": int(action),
            "action_label": labels[int(action)],
            "confidence": 0.85, # PPO doesn't give direct confidence easily, but we can mock for UI
            "price": float(current_price),
            "timestamp": str(latest_row['timestamp'])
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
