import os
import pandas as pd
import numpy as np
import torch as th
from sb3_contrib import RecurrentPPO
from trading_env import CryptoTradingEnv

def evaluate():
    print("--- NEXUS AI: Performance Evaluation ---")
    
    # 1. Load the trained brain
    model_path = "backend/nexus_trading_agent_ppo_v11.zip"
    if not os.path.exists(model_path): model_path = "nexus_trading_agent_ppo_v11.zip"
    try:
        model = RecurrentPPO.load(model_path)
        print(f"Successfully loaded brain: {model_path}")
    except Exception as e:
        print(f"Error loading model: {e}")
        return

    # 2. Load the data
    data_file = 'backend/historical_data.csv'
    if not os.path.exists(data_file): data_file = 'historical_data.csv'
    df = pd.read_csv(data_file)
    
    # 2. Centralized Feature Extraction
    from data_pipeline import get_features, normalize_features
    features_df = get_features(df)
    
    # Normalize
    features_df = normalize_features(features_df, is_training=False)
    
    # Re-attach price columns needed for environment execution
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
    
    # 3. Initialize Environment
    env = CryptoTradingEnv(features_df)
    obs, _ = env.reset()
    
    # 4. Run the simulation
    done = False
    starting_balance = 10000.0
    env.balance = starting_balance
    env.initial_balance = starting_balance
    
    closed_trades = 0
    wins = 0
    losses = 0
    breakevens = 0
    
    win_profits = []
    loss_amounts = []
    
    # Track Directional Accuracy
    correct_directions = 0
    total_steps = 0
    
    print(f"Simulating $100 Portfolio Growth...")
    
    lstm_states = None
    episode_start = np.ones((1,), dtype=bool)
    
    max_confidence_seen = 0
    while not done:
        # 1. Predict Action
        action, lstm_states = model.predict(obs, state=lstm_states, episode_start=episode_start, deterministic=True)
        episode_start = np.zeros((1,), dtype=bool) 

        # 2. Sniper Gate Logic (Confidence Filter)
        obs_tensor, _ = model.policy.obs_to_tensor(obs)
        with th.no_grad():
            h_state = th.tensor(lstm_states[0]).to(model.policy.device)
            c_state = th.tensor(lstm_states[1]).to(model.policy.device)
            distribution, _ = model.policy.get_distribution(obs_tensor, (h_state, c_state), th.tensor(episode_start).to(model.policy.device))
            probs = th.softmax(distribution.distribution.logits, dim=-1)
            confidence = probs[0][action].item()
            
            if action != 0:
                max_confidence_seen = max(max_confidence_seen, confidence)

        # Sniper Gate: Diagnosing at 50%
        effective_action = action
        if action != 0 and confidence < 0.50:
            effective_action = 0 
        
        # 3. Step Environment
        obs, reward, terminated, truncated, info = env.step(effective_action)
        
        # Detect a CLOSED trade
        if info.get('trade_closed', False):
            closed_trades += 1
            trade_pnl_pct = info.get('trade_pnl_pct', 0)
            
            if trade_pnl_pct > 0.1: # Profitable
                wins += 1
                win_profits.append(trade_pnl_pct)
            elif trade_pnl_pct < -0.1: # Loss
                losses += 1
                loss_amounts.append(trade_pnl_pct)
            else: # Breakeven
                breakevens += 1
        
        done = terminated or truncated

    # 5. Final Granular Report
    final_net_worth = env.net_worth
    total_increase = ((final_net_worth - starting_balance) / starting_balance) * 100
    avg_win = np.mean(win_profits) if win_profits else 0
    avg_loss = np.mean(loss_amounts) if loss_amounts else 0
    dir_acc = (correct_directions / total_steps * 100) if total_steps > 0 else 0

    print("\n" + "="*40)
    print("      $100 PORTFOLIO IMPACT REPORT")
    print("="*40)
    print(f"Starting Balance:    ${starting_balance:,.2f}")
    print(f"Final Net Worth:     ${final_net_worth:,.2f}")
    print(f"Total Portfolio %:   {total_increase:+.2f}%")
    print("-" * 40)
    print(f"Total Trades:        {closed_trades}")
    print(f"Trade Win Rate:      {(wins/closed_trades*100):.2f}%" if closed_trades > 0 else "0.00%")
    print(f"DIRECTIONAL ACCURACY: {dir_acc:.2f}%")
    print("-" * 40)
    print(f"Successful Wins:     {wins} (Avg: {avg_win:+.2f}%)")
    print(f"Losses:              {losses} (Avg: {avg_loss:+.2f}%)")
    print(f"Break-evens:         {breakevens}")
    print(f"MAX SIGNAL CONFIDENCE: {max_confidence_seen:.2%}")
    print("-" * 40)
    print("="*40)

if __name__ == "__main__":
    evaluate()
