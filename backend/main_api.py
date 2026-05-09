import os
import pandas as pd
import numpy as np
import ccxt
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from sb3_contrib import RecurrentPPO
from data_pipeline import get_features, normalize_features, calculate_institutional_features
from signal_engine import analyze_timeframe, merge_timeframe_signals, get_higher_timeframe
from typing import Dict, List, Optional
import traceback

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
    # Search in both 'backend/checkpoints' and 'checkpoints' depending on where we are running
    search_paths = ["backend/checkpoints/*.zip", "checkpoints/*.zip"]
    checkpoints = []
    for path in search_paths:
        checkpoints.extend(glob.glob(path))
    
    model_path = "backend/nexus_trading_agent_ppo_v11.zip"
    if not os.path.exists(model_path):
        model_path = "nexus_trading_agent_ppo_v11.zip"

    if checkpoints:
        try:
            # Sort by step count (nexus_v11_XXXX_steps.zip)
            latest_checkpoint = max(checkpoints, key=lambda x: int(x.split('_')[-2]))
            model_path = latest_checkpoint
            print(f"Loading latest institutional checkpoint for API: {model_path}")
        except: pass
        
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
    signal_score: float
    regime: str
    pattern: str
    setup: str
    stop_loss: float
    take_profit_1: float
    take_profit_2: float
    risk_reward: float
    timeframe_confluence: str
    higher_timeframe: Optional[str] = None
    higher_timeframe_score: float
    reasons: List[str]
    components: Dict[str, float]

@app.get("/")
async def root():
    return {"status": "online", "engine": "NEXUS PPO v11 (Bug Free)", "auth": "enabled"}

@app.post("/predict", response_model=PredictionResponse)
async def predict(request: PredictionRequest):
    # Ensure model is fresh
    global model
    if model is None:
        model = load_latest_model()

    try:
        # 1. Fetch latest data for primary timeframe
        exchange = ccxt.binance()
        ohlcv = exchange.fetch_ohlcv(request.symbol, request.timeframe, limit=260)
        if not ohlcv:
            raise HTTPException(status_code=400, detail="No market data returned from exchange")

        df = pd.DataFrame(ohlcv, columns=["timestamp", "open", "high", "low", "close", "volume"])
        df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms")

        # 2. Institutional feature extraction
        df = calculate_institutional_features(df)
        if len(df) < 40:
            raise HTTPException(status_code=400, detail="Not enough processed candles for reliable analysis")

        # 3. RL signal (used as a weighted confluence, not the only decision maker)
        rl_action = None
        features_df = get_features(df)
        norm_df = normalize_features(features_df, is_training=False)
        latest_obs = norm_df.iloc[-1].values.tolist()

        latest_obs.append(df.iloc[-1]["close"])
        latest_obs.extend([10000.0, 0.0])
        obs = np.array(latest_obs, dtype=np.float32)

        if model is not None:
            try:
                lstm_states = None
                episode_start = np.ones((1,), dtype=bool)
                rl_pred, _states = model.predict(
                    obs, state=lstm_states, episode_start=episode_start, deterministic=True
                )
                rl_action = int(rl_pred)
            except Exception:
                rl_action = None

        # 4. Primary timeframe analysis
        primary = analyze_timeframe(df, request.timeframe, rl_action=rl_action)

        # 5. Higher timeframe confluence analysis
        higher_timeframe = get_higher_timeframe(request.timeframe)
        higher = None
        if higher_timeframe != request.timeframe:
            try:
                higher_ohlcv = exchange.fetch_ohlcv(request.symbol, higher_timeframe, limit=260)
                if higher_ohlcv:
                    higher_df = pd.DataFrame(
                        higher_ohlcv, columns=["timestamp", "open", "high", "low", "close", "volume"]
                    )
                    higher_df["timestamp"] = pd.to_datetime(higher_df["timestamp"], unit="ms")
                    higher_df = calculate_institutional_features(higher_df)
                    if len(higher_df) >= 40:
                        higher = analyze_timeframe(higher_df, higher_timeframe, rl_action=None)
            except Exception:
                higher = None

        final_signal = merge_timeframe_signals(primary, higher)
        latest_row = df.iloc[-1]

        return {
            "symbol": request.symbol,
            "action": int(final_signal["action"]),
            "action_label": final_signal["action_label"],
            "confidence": float(final_signal["confidence"]),
            "price": float(latest_row["close"]),
            "timestamp": str(latest_row["timestamp"]),
            "signal_score": float(final_signal["signal_score"]),
            "regime": final_signal["regime"],
            "pattern": final_signal["pattern"],
            "setup": final_signal["setup"],
            "stop_loss": float(final_signal["stop_loss"]),
            "take_profit_1": float(final_signal["take_profit_1"]),
            "take_profit_2": float(final_signal["take_profit_2"]),
            "risk_reward": float(final_signal["risk_reward"]),
            "timeframe_confluence": final_signal["timeframe_confluence"],
            "higher_timeframe": final_signal["higher_timeframe"],
            "higher_timeframe_score": float(final_signal["higher_timeframe_score"]),
            "reasons": final_signal["reasons"],
            "components": {k: float(v) for k, v in final_signal["components"].items()},
        }

    except Exception as e:
        print("❌ Prediction Error:")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    # Railway provides the port via the PORT environment variable
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
