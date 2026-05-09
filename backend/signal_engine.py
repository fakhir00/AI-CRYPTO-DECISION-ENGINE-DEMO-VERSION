from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd


ACTION_LABELS = {
    0: "HOLD",
    1: "BUY (LONG)",
    2: "SELL (SHORT)",
}

HIGHER_TIMEFRAME_MAP = {
    "1m": "5m",
    "3m": "15m",
    "5m": "15m",
    "15m": "1h",
    "30m": "2h",
    "1h": "4h",
    "2h": "6h",
    "4h": "1d",
    "6h": "1d",
    "8h": "1d",
    "12h": "1d",
    "1d": "1w",
}


def get_higher_timeframe(timeframe: str) -> str:
    return HIGHER_TIMEFRAME_MAP.get(timeframe, timeframe)


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _safe_float(value, default: float = 0.0) -> float:
    try:
        parsed = float(value)
        if np.isnan(parsed):
            return default
        return parsed
    except Exception:
        return default


def _linear_slope(series: pd.Series) -> float:
    clean = pd.Series(series).dropna().astype(float).values
    if len(clean) < 2:
        return 0.0
    x = np.arange(len(clean), dtype=np.float64)
    return float(np.polyfit(x, clean, 1)[0])


def _candle_geometry(candle: pd.Series) -> Dict[str, float]:
    o = _safe_float(candle.get("open"))
    h = _safe_float(candle.get("high"))
    l = _safe_float(candle.get("low"))
    c = _safe_float(candle.get("close"))
    rng = max(h - l, 1e-9)
    body = abs(c - o)
    upper = h - max(o, c)
    lower = min(o, c) - l
    return {
        "open": o,
        "high": h,
        "low": l,
        "close": c,
        "range": rng,
        "body": body,
        "upper": upper,
        "lower": lower,
        "is_bull": 1.0 if c >= o else 0.0,
    }


def detect_candlestick_pattern(df: pd.DataFrame) -> Tuple[str, float]:
    if len(df) < 3:
        return "No clear pattern", 0.0

    c0 = df.iloc[-1]
    c1 = df.iloc[-2]
    c2 = df.iloc[-3]
    g0 = _candle_geometry(c0)
    g1 = _candle_geometry(c1)
    g2 = _candle_geometry(c2)

    patterns: List[Tuple[str, float]] = []

    if (
        g1["close"] < g1["open"]
        and g0["close"] > g0["open"]
        and g0["open"] <= g1["close"]
        and g0["close"] >= g1["open"]
    ):
        patterns.append(("Bullish Engulfing", 14.0))

    if (
        g1["close"] > g1["open"]
        and g0["close"] < g0["open"]
        and g0["open"] >= g1["close"]
        and g0["close"] <= g1["open"]
    ):
        patterns.append(("Bearish Engulfing", -14.0))

    if g0["lower"] > (g0["body"] * 2.2) and g0["upper"] < (g0["body"] * 0.8) and g0["close"] > g0["open"]:
        patterns.append(("Hammer Reversal", 10.0))

    if g0["upper"] > (g0["body"] * 2.2) and g0["lower"] < (g0["body"] * 0.8) and g0["close"] < g0["open"]:
        patterns.append(("Shooting Star Reversal", -10.0))

    if (g0["body"] / g0["range"]) < 0.08:
        patterns.append(("Doji Indecision", 0.0))

    c2_body_ratio = g2["body"] / g2["range"]
    c1_body_ratio = g1["body"] / g1["range"]
    c0_body_ratio = g0["body"] / g0["range"]

    morning_star = (
        g2["close"] < g2["open"]
        and c2_body_ratio > 0.45
        and c1_body_ratio < 0.3
        and g0["close"] > g0["open"]
        and g0["close"] > (g2["open"] + g2["close"]) / 2
    )
    if morning_star:
        patterns.append(("Morning Star", 16.0))

    evening_star = (
        g2["close"] > g2["open"]
        and c2_body_ratio > 0.45
        and c1_body_ratio < 0.3
        and g0["close"] < g0["open"]
        and g0["close"] < (g2["open"] + g2["close"]) / 2
    )
    if evening_star:
        patterns.append(("Evening Star", -16.0))

    strong_bull = c0_body_ratio > 0.7 and g0["close"] > g0["open"]
    strong_bear = c0_body_ratio > 0.7 and g0["close"] < g0["open"]
    if strong_bull:
        patterns.append(("Bullish Momentum Candle", 8.0))
    if strong_bear:
        patterns.append(("Bearish Momentum Candle", -8.0))

    if not patterns:
        return "No clear pattern", 0.0

    best_pattern = max(patterns, key=lambda x: abs(x[1]))
    return best_pattern[0], float(best_pattern[1])


def _calculate_trade_levels(level_inputs: Dict[str, float], action: int) -> Dict[str, float]:
    close = _safe_float(level_inputs.get("close"))
    atr = _safe_float(level_inputs.get("atr"), close * 0.004)
    res1 = _safe_float(level_inputs.get("res1"), close + atr)
    sup1 = _safe_float(level_inputs.get("sup1"), close - atr)
    local_res = _safe_float(level_inputs.get("local_res"), close + atr * 2)
    local_sup = _safe_float(level_inputs.get("local_sup"), close - atr * 2)

    if atr <= 0:
        atr = close * 0.004
    if close <= 0:
        return {"stop_loss": 0.0, "take_profit_1": 0.0, "take_profit_2": 0.0, "risk_reward": 0.0}

    if action == 1:
        stop_candidates = [close - (atr * 1.8), sup1, local_sup]
        valid_stop = [x for x in stop_candidates if 0 < x < close]
        stop = max(valid_stop) if valid_stop else close - (atr * 1.8)

        tp1_candidates = [close + (atr * 1.5), res1]
        valid_tp1 = [x for x in tp1_candidates if x > close]
        tp1 = max(valid_tp1) if valid_tp1 else close + (atr * 1.5)

        tp2_candidates = [close + (atr * 3.2), local_res, tp1 + (atr * 1.2)]
        valid_tp2 = [x for x in tp2_candidates if x > tp1]
        tp2 = max(valid_tp2) if valid_tp2 else tp1 + (atr * 1.2)
    elif action == 2:
        stop_candidates = [close + (atr * 1.8), res1, local_res]
        valid_stop = [x for x in stop_candidates if x > close]
        stop = min(valid_stop) if valid_stop else close + (atr * 1.8)

        tp1_candidates = [close - (atr * 1.5), sup1]
        valid_tp1 = [x for x in tp1_candidates if 0 < x < close]
        tp1 = min(valid_tp1) if valid_tp1 else close - (atr * 1.5)

        tp2_candidates = [close - (atr * 3.2), local_sup, tp1 - (atr * 1.2)]
        valid_tp2 = [x for x in tp2_candidates if 0 < x < tp1]
        tp2 = min(valid_tp2) if valid_tp2 else max(tp1 - (atr * 1.2), 0.0)
    else:
        return {"stop_loss": 0.0, "take_profit_1": 0.0, "take_profit_2": 0.0, "risk_reward": 0.0}

    risk = abs(close - stop)
    reward = abs(tp2 - close)
    rr = reward / risk if risk > 0 else 0.0

    return {
        "stop_loss": round(stop, 6),
        "take_profit_1": round(tp1, 6),
        "take_profit_2": round(tp2, 6),
        "risk_reward": round(rr, 2),
    }


def analyze_timeframe(df: pd.DataFrame, timeframe: str, rl_action: Optional[int] = None) -> Dict:
    if df is None or len(df) < 35:
        raise ValueError(f"Insufficient candles for analysis on {timeframe}. Need at least 35.")

    view = df.copy().tail(160).reset_index(drop=True)
    latest = view.iloc[-1]
    prev = view.iloc[-2]

    close = _safe_float(latest.get("close"))
    open_price = _safe_float(latest.get("open"))
    high = _safe_float(latest.get("high"))
    low = _safe_float(latest.get("low"))
    volume = _safe_float(latest.get("volume"))

    ema9 = _safe_float(latest.get("ema_9"), close)
    ema21 = _safe_float(latest.get("ema_21"), close)
    rsi = _safe_float(latest.get("rsi"), 50.0)
    macd = _safe_float(latest.get("macd"))
    macd_signal = _safe_float(latest.get("macd_signal"))
    atr = _safe_float(latest.get("atr"), close * 0.004)
    res1 = _safe_float(latest.get("res1"), close + atr)
    sup1 = _safe_float(latest.get("sup1"), close - atr)
    local_res = _safe_float(latest.get("local_res"), close + atr * 2)
    local_sup = _safe_float(latest.get("local_sup"), close - atr * 2)

    # Trend component
    trend_score = 0.0
    ema_gap_pct = ((ema9 - ema21) / close) * 100 if close > 0 else 0.0
    slope9 = _linear_slope(view["ema_9"].tail(8))
    slope21 = _linear_slope(view["ema_21"].tail(8))
    slope9_pct = (slope9 / close) * 100 if close > 0 else 0.0
    slope21_pct = (slope21 / close) * 100 if close > 0 else 0.0

    trend_score += 16.0 if ema9 > ema21 else -16.0
    trend_score += 7.0 if slope9_pct > 0 else -7.0
    trend_score += 5.0 if slope21_pct > 0 else -5.0
    if close > ema9 and close > ema21:
        trend_score += 5.0
    elif close < ema9 and close < ema21:
        trend_score -= 5.0
    trend_score = _clamp(trend_score, -35.0, 35.0)

    if abs(ema_gap_pct) < 0.15 and abs(slope21_pct) < 0.015:
        regime = "Sideways / Range"
    elif ema9 > ema21 and slope21_pct > 0:
        regime = "Bullish Trend"
    elif ema9 < ema21 and slope21_pct < 0:
        regime = "Bearish Trend"
    else:
        regime = "Transition"

    # Momentum component
    momentum_score = 0.0
    macd_hist = macd - macd_signal
    prev_macd_hist = _safe_float(prev.get("macd")) - _safe_float(prev.get("macd_signal"))
    recent_momentum = _safe_float(view["close"].pct_change().tail(3).mean())

    if rsi >= 65:
        momentum_score += 10.0
    elif rsi >= 55:
        momentum_score += 6.0
    elif rsi <= 35:
        momentum_score -= 10.0
    elif rsi <= 45:
        momentum_score -= 6.0

    momentum_score += 8.0 if macd_hist > 0 else -8.0
    momentum_score += 4.0 if macd_hist > prev_macd_hist else -4.0
    if recent_momentum > 0.002:
        momentum_score += 4.0
    elif recent_momentum < -0.002:
        momentum_score -= 4.0
    momentum_score = _clamp(momentum_score, -25.0, 25.0)

    # Volume confirmation
    volume_window = view["volume"].tail(40)
    vol_mean = _safe_float(volume_window.mean(), volume)
    vol_std = _safe_float(volume_window.std(ddof=0), 0.0)
    vol_z = (volume - vol_mean) / vol_std if vol_std > 1e-9 else 0.0
    candle_range = max(high - low, 1e-9)
    candle_body = abs(close - open_price)
    body_ratio = candle_body / candle_range

    volume_score = 0.0
    if vol_z > 1.2:
        volume_score += 6.0 if close >= open_price else -6.0
    elif vol_z < -0.8:
        volume_score += -2.0 if close >= open_price else 2.0
    if body_ratio > 0.55 and vol_z > 0.6:
        volume_score += 3.0 if close >= open_price else -3.0
    volume_score = _clamp(volume_score, -10.0, 10.0)

    # Candlestick pattern component
    pattern, pattern_score = detect_candlestick_pattern(view.tail(10))
    pattern_score = _clamp(pattern_score, -18.0, 18.0)

    # Structure component
    structure_score = 0.0
    swing_window = view.tail(48)
    prev_swing_high = _safe_float(swing_window["high"].iloc[:-1].max(), high)
    prev_swing_low = _safe_float(swing_window["low"].iloc[:-1].min(), low)

    if close > prev_swing_high and vol_z > 0.5:
        structure_score += 10.0
    elif close < prev_swing_low and vol_z > 0.5:
        structure_score -= 10.0

    dist_to_res_pct = ((local_res - close) / close) * 100 if close > 0 else 0.0
    dist_to_sup_pct = ((close - local_sup) / close) * 100 if close > 0 else 0.0
    if dist_to_res_pct > dist_to_sup_pct + 0.35:
        structure_score += 4.0
    elif dist_to_sup_pct > dist_to_res_pct + 0.35:
        structure_score -= 4.0

    if close > res1:
        structure_score += 3.0
    elif close < sup1:
        structure_score -= 3.0

    upper_wick = high - max(open_price, close)
    lower_wick = min(open_price, close) - low
    if lower_wick > candle_body * 1.8 and close > open_price:
        structure_score += 3.0
    if upper_wick > candle_body * 1.8 and close < open_price:
        structure_score -= 3.0

    structure_score = _clamp(structure_score, -20.0, 20.0)

    # RL confluence is a secondary factor
    rl_bias = 0.0
    if rl_action == 1:
        rl_bias = 8.0
    elif rl_action == 2:
        rl_bias = -8.0

    components = {
        "trend": round(trend_score, 2),
        "momentum": round(momentum_score, 2),
        "volume": round(volume_score, 2),
        "pattern": round(pattern_score, 2),
        "structure": round(structure_score, 2),
        "rl_bias": round(rl_bias, 2),
    }
    signal_score = _clamp(sum(components.values()), -100.0, 100.0)

    if signal_score >= 16.0:
        action = 1
    elif signal_score <= -16.0:
        action = 2
    else:
        action = 0

    direction = 1 if signal_score > 0 else -1 if signal_score < 0 else 0
    non_zero_components = [v for v in components.values() if abs(v) > 0.1]
    if direction != 0 and non_zero_components:
        aligned = sum(1 for v in non_zero_components if np.sign(v) == direction)
        agreement = aligned / len(non_zero_components)
    else:
        agreement = 0.5

    atr_pct = ((atr / close) * 100) if close > 0 else 0.0
    if atr_pct > 5.0:
        volatility_penalty = 0.12
    elif atr_pct > 3.0:
        volatility_penalty = 0.06
    elif atr_pct < 0.6:
        volatility_penalty = 0.04
    else:
        volatility_penalty = 0.0

    if action == 0:
        confidence = _clamp(0.56 + (0.08 if regime == "Sideways / Range" else 0.0) - volatility_penalty, 0.45, 0.90)
    else:
        confidence = _clamp(
            0.52 + (abs(signal_score) / 120.0) + ((agreement - 0.5) * 0.24) - volatility_penalty,
            0.50,
            0.99,
        )

    if abs(pattern_score) >= 12.0:
        setup = "Pattern-Driven Reversal/Continuation"
    elif abs(structure_score) >= 10.0:
        setup = "Breakout / Structure Shift"
    elif abs(trend_score) >= 20.0:
        setup = "Trend Continuation"
    elif regime == "Sideways / Range":
        setup = "Range / No-Trade"
    else:
        setup = "Mixed Signals"

    level_inputs = {
        "close": close,
        "atr": atr,
        "res1": res1,
        "sup1": sup1,
        "local_res": local_res,
        "local_sup": local_sup,
    }
    levels = _calculate_trade_levels(level_inputs, action)

    reasons: List[str] = [
        f"Trend: EMA9 vs EMA21 gap {ema_gap_pct:+.2f}% with EMA21 slope {slope21_pct:+.4f}%.",
        f"Momentum: RSI {rsi:.1f}, MACD histogram {macd_hist:+.4f} ({'rising' if macd_hist > prev_macd_hist else 'falling'}).",
        f"Pattern: {pattern}.",
        f"Volume confirmation: z-score {vol_z:+.2f}, candle body/range {body_ratio:.2f}.",
        f"Structure: swing-high {prev_swing_high:.4f}, swing-low {prev_swing_low:.4f}, ATR {atr_pct:.2f}% of price.",
    ]

    if rl_action is not None:
        reasons.append(f"RL model bias used only as confluence: {ACTION_LABELS.get(rl_action, 'HOLD')}.")

    return {
        "timeframe": timeframe,
        "action": action,
        "action_label": ACTION_LABELS[action],
        "confidence": round(float(confidence), 4),
        "signal_score": round(float(signal_score), 2),
        "regime": regime,
        "pattern": pattern,
        "setup": setup,
        "stop_loss": levels["stop_loss"],
        "take_profit_1": levels["take_profit_1"],
        "take_profit_2": levels["take_profit_2"],
        "risk_reward": levels["risk_reward"],
        "reasons": reasons[:6],
        "components": components,
        "level_inputs": level_inputs,
    }


def merge_timeframe_signals(primary: Dict, higher: Optional[Dict]) -> Dict:
    if not higher:
        primary.pop("level_inputs", None)
        primary["higher_timeframe"] = None
        primary["higher_timeframe_score"] = 0.0
        primary["timeframe_confluence"] = "No higher timeframe confluence"
        return primary

    combined_score = _clamp((primary["signal_score"] * 0.72) + (higher["signal_score"] * 0.28), -100.0, 100.0)
    p_dir = 1 if primary["signal_score"] > 0 else -1 if primary["signal_score"] < 0 else 0
    h_dir = 1 if higher["signal_score"] > 0 else -1 if higher["signal_score"] < 0 else 0

    confidence_adjustment = 0.0
    if p_dir != 0 and h_dir != 0 and p_dir == h_dir:
        confluence = "Aligned"
        confidence_adjustment = 0.07
    elif p_dir != 0 and h_dir != 0 and p_dir != h_dir:
        confluence = "Conflict"
        confidence_adjustment = -0.10
    elif h_dir == 0:
        confluence = "Higher timeframe neutral"
        confidence_adjustment = -0.03
    else:
        confluence = "Partial"

    if combined_score >= 16.0:
        action = 1
    elif combined_score <= -16.0:
        action = 2
    else:
        action = 0

    confidence = _clamp(primary["confidence"] + confidence_adjustment, 0.45, 0.99)
    if action == 0:
        confidence = max(confidence, 0.55)

    levels = _calculate_trade_levels(primary.get("level_inputs", {}), action)

    merged = dict(primary)
    merged["action"] = action
    merged["action_label"] = ACTION_LABELS[action]
    merged["confidence"] = round(float(confidence), 4)
    merged["signal_score"] = round(float(combined_score), 2)
    merged["stop_loss"] = levels["stop_loss"]
    merged["take_profit_1"] = levels["take_profit_1"]
    merged["take_profit_2"] = levels["take_profit_2"]
    merged["risk_reward"] = levels["risk_reward"]
    merged["higher_timeframe"] = higher.get("timeframe")
    merged["higher_timeframe_score"] = higher.get("signal_score", 0.0)
    merged["timeframe_confluence"] = confluence

    reasons = list(merged.get("reasons", []))
    reasons.append(
        f"Multi-timeframe check ({higher.get('timeframe')}): score {higher.get('signal_score', 0.0):+.2f}, confluence {confluence}."
    )
    merged["reasons"] = reasons[:6]
    merged.pop("level_inputs", None)
    return merged
