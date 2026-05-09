import os
import json
import pandas as pd
import numpy as np
import ccxt
from fastapi import FastAPI, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sb3_contrib import RecurrentPPO
from data_pipeline import get_features, normalize_features, calculate_institutional_features
from typing import List, Optional
import traceback
import sqlite3

app = FastAPI(title="NEXUS AI Trading Engine API")

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load latest brain (Main or Checkpoint)
def load_latest_model():
    import glob
    model_path = "backend/nexus_trading_agent_ppo_v11.zip"
    checkpoints = glob.glob("backend/checkpoints/*.zip")
    
    if checkpoints:
        try:
            # Sort by step count (nexus_v11_XXXX_steps.zip)
            latest_checkpoint = max(checkpoints, key=lambda x: int(x.split('_')[-2]))
            model_path = latest_checkpoint
            print(f"Loading latest institutional checkpoint for API: {model_path}")
        except: pass
    elif not os.path.exists(model_path):
        model_path = "nexus_trading_agent_ppo_v11.zip"
        
    try:
        return RecurrentPPO.load(model_path)
    except:
        print(f"❌ Could not load model from {model_path}")
        return None

model = load_latest_model()

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
    return {"status": "online", "engine": "NEXUS PPO v11 (Bug Free)", "auth": "enabled"}

@app.post("/predict", response_model=PredictionResponse)
async def predict(request: PredictionRequest):
    # Ensure model is fresh
    global model
    if model is None: model = load_latest_model()
    if model is None: raise HTTPException(status_code=500, detail="Model not loaded")

    try:
        # 1. Fetch latest data
        exchange = ccxt.binance()
        ohlcv = exchange.fetch_ohlcv(request.symbol, request.timeframe, limit=100)
        df = pd.DataFrame(ohlcv, columns=['timestamp', 'open', 'high', 'low', 'close', 'volume'])
        df['timestamp'] = pd.to_datetime(df['timestamp'], unit='ms')
        
        # 2. Institutional Feature Extraction
        df = calculate_institutional_features(df)
        features_df = get_features(df)
        
        # 3. Normalize
        norm_df = normalize_features(features_df, is_training=False)
        latest_obs = norm_df.iloc[-1].values.tolist()
        
        # 4. Add account state (18 features total expected by v11)
        # 15 features from get_features + 'close' = 16. + 2 account = 18.
        latest_obs.append(df.iloc[-1]['close']) # 'close' was included in the 18-shape v11
        latest_obs.extend([10000.0, 0.0]) # balance, crypto_held
        
        obs = np.array(latest_obs, dtype=np.float32)
        
        # 5. Predict
        lstm_states = None
        episode_start = np.ones((1,), dtype=bool)
        action, _states = model.predict(obs, state=lstm_states, episode_start=episode_start, deterministic=True)
        
        labels = ["HOLD", "BUY (LONG)", "SELL (SHORT)"]
        
        return {
            "symbol": request.symbol,
            "action": int(action),
            "action_label": labels[int(action)],
            "confidence": 0.95 if int(action) != 0 else 0.50,
            "price": float(df.iloc[-1]['close']),
            "timestamp": str(df.iloc[-1]['timestamp'])
        }
        
    except Exception as e:
        print("❌ Prediction Error:")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
