import gymnasium as gym
from gymnasium import spaces
import numpy as np

class CryptoTradingEnv(gym.Env):
    """
    Institutional Grade Trading Environment with 2% Max Risk & SL/TP Management.
    """
    metadata = {'render_modes': ['human']}

    def __init__(self, df, initial_balance=10000):
        super(CryptoTradingEnv, self).__init__()
        
        self.df = df
        self.symbol = "BTCUSDT"
        self.initial_balance = initial_balance
        self.fee_percent = 0.001 
        
        # v8.5 Hyper-Growth Geometry
        self.max_risk_pct = 0.03      # 3% Risk (Aggressive Growth)
        self.position_pct = 0.20      # 20% Position
        self.sl_atr = 2.5             # Deep Defense (Avoid Shakeouts)
        self.tp1_atr = 1.5            # T1 at 1.5 ATR
        self.tp2_atr = 6.0            # T2 for Major Portfolio Growth
        self.trailing_sl_multiplier = 1.5 # Trail SL by 1.5 ATR
        
        # Actions: 0 = Hold, 1 = Buy (Long), 2 = Sell (Short)
        self.action_space = spaces.Discrete(3)
        
        # State shape: Price data + Technical Indicators + Account Balance + Held Crypto
        # We normalize these values in a real scenario
        self.observation_space = spaces.Box(
            low=-np.inf, high=np.inf, shape=(len(self.df.columns) + 2,), dtype=np.float32
        )
        
        self.reset()

    def reset(self, seed=None, options=None):
        super().reset(seed=seed)
        self.current_step = 0
        self.balance = self.initial_balance
        self.crypto_held = 0.0
        self.net_worth = self.initial_balance
        self.max_net_worth = self.initial_balance
        self.partial_profit_taken = False # Track T1
        
        return self._get_observation(), {}

    def _get_observation(self):
        # Current row of data
        obs = self.df.iloc[self.current_step].values.tolist()
        # Add account state
        obs.extend([self.balance, self.crypto_held])
        return np.array(obs, dtype=np.float32)

    def _calculate_sl_tp_v5(self, entry_price, action, atr, row):
        # Dynamic SL based on ATR
        sl_dist = atr * self.sl_atr
        
        # Resistance-Based TP (Using Local Res/Pivot)
        if action == 1: # LONG
            stop_price = entry_price - sl_dist
            tp1_price = max(entry_price + (atr * 0.5), row['res1']) # At least 0.5 ATR or Pivot Res
            tp2_price = max(tp1_price + (atr * 1.0), row['local_res']) # Second target at Local High
        else: # SHORT
            stop_price = entry_price + sl_dist
            tp1_price = min(entry_price - (atr * 0.5), row['sup1']) # At least 0.5 ATR or Pivot Sup
            tp2_price = min(tp1_price - (atr * 1.0), row['local_sup']) # Second target at Local Low
            
        return stop_price, tp1_price, tp2_price

    def _calculate_position_size(self, entry_price, stop_price, action):
        risk_per_unit = abs(entry_price - stop_price)
        max_risk_usd = self.balance * self.max_risk_pct
        
        if risk_per_unit == 0: return 0
        
        units = max_risk_usd / risk_per_unit
        pos_usd = units * entry_price
        
        # Cap at 5% position limit
        max_pos_usd = self.balance * self.position_pct
        return min(pos_usd, max_pos_usd)

    def step(self, action):
        current_price = self.df.iloc[self.current_step]['close']
        prev_held = self.crypto_held
        prev_net_worth = self.net_worth
        
        # Execute Action with v5.0 Resistance-Based Geometry
        if action != 0 and self.crypto_held == 0:
            row = self.df.iloc[self.current_step]
            stop, tp1, tp2 = self._calculate_sl_tp_v5(current_price, action, row['atr'], row)
            position_usd = self._calculate_position_size(current_price, stop, action)
            
            if (action == 1 and row['ema_9'] < row['ema_21']) or (action == 2 and row['ema_9'] > row['ema_21']):
                action = 0 # Trend Lock
            
            if action != 0 and position_usd >= 5: 
                fee = position_usd * self.fee_percent
                self.balance -= (position_usd + fee)
                self.crypto_held = position_usd / current_price
                self.entry_price = current_price
                self.stop_loss = stop
                self.tp1 = tp1
                self.tp2 = tp2
                self.trade_direction = action
                self.partial_profit_taken = False
        
        self.t1_hit_this_step = False
        
        # Check SL/TP if in position
        if self.crypto_held > 0:
            if self.trade_direction == 1: # LONG
                # 1. Partial Profit Taking (T1) + Trailing SL Init
                if not self.partial_profit_taken and current_price >= self.tp1:
                    # Sell 50%
                    sell_amount = (self.crypto_held * 0.5) * current_price * (1 - self.fee_percent)
                    self.balance += sell_amount
                    self.crypto_held *= 0.5
                    self.partial_profit_taken = True
                    self.t1_hit_this_step = True
                    # Initialize Trailing SL
                    self.stop_loss = current_price - (self.df.iloc[self.current_step]['atr'] * self.trailing_sl_multiplier)
                
                # 2. Final TP (T2) or SL
                if current_price <= self.stop_loss or current_price >= self.tp2:
                    self.balance += (self.crypto_held * current_price) * (1 - self.fee_percent)
                    self.crypto_held = 0
                
                # 3. Dynamic Trailing (Move SL up)
                if self.partial_profit_taken and self.crypto_held > 0:
                    new_sl = current_price - (self.df.iloc[self.current_step]['atr'] * self.trailing_sl_multiplier)
                    if new_sl > self.stop_loss:
                        self.stop_loss = new_sl
            else: # SHORT
                # 1. Partial Profit Taking (T1) + Trailing SL Init
                if not self.partial_profit_taken and current_price <= self.tp1:
                    profit = (self.entry_price - current_price) * (self.crypto_held * 0.5)
                    self.balance += (self.entry_price * (self.crypto_held * 0.5) + profit) * (1 - self.fee_percent)
                    self.crypto_held *= 0.5
                    self.partial_profit_taken = True
                    self.t1_hit_this_step = True
                    self.stop_loss = current_price + (self.df.iloc[self.current_step]['atr'] * self.trailing_sl_multiplier)
                
                # 2. Final TP (T2) or SL
                if current_price >= self.stop_loss or current_price <= self.tp2:
                    profit = (self.entry_price - current_price) * self.crypto_held
                    self.balance += (self.entry_price * self.crypto_held + profit) * (1 - self.fee_percent)
                    self.crypto_held = 0

                # 3. Dynamic Trailing (Move SL down)
                if self.partial_profit_taken and self.crypto_held > 0:
                    new_sl = current_price + (self.df.iloc[self.current_step]['atr'] * self.trailing_sl_multiplier)
                    if new_sl < self.stop_loss:
                        self.stop_loss = new_sl
                
        # Calculate new net worth
        last_net_worth = self.net_worth
        self.net_worth = self.balance + (self.crypto_held * current_price)
        self.max_net_worth = max(self.net_worth, self.max_net_worth)
        
        # Calculate Reward
        net_worth_change = (self.net_worth - last_net_worth) / last_net_worth
        
        # v4.9 Pure Accuracy Optimizer Logic
        reward = 0
        
        # 1. Immediate Win Reward (T1 Hit)
        if getattr(self, 't1_hit_this_step', False):
            reward += 200.0 # Massive reward for the win
            
        # 2. Devastating SL Penalty
        if prev_held > 0 and self.crypto_held == 0 and self.net_worth < prev_net_worth:
            reward -= 300.0 # Extreme penalty for losing a trade
            
        # 3. Market Participation Pressure
        if action == 0 and self.crypto_held == 0:
            reward -= 0.1
            
        # 4. Entry Guidance (Success Pattern Alignment)
        rsi = self.df.iloc[self.current_step-1]['rsi']
        ema9 = self.df.iloc[self.current_step-1]['ema_9']
        ema21 = self.df.iloc[self.current_step-1]['ema_21']
        
        if action == 1: # LONG
            if rsi < 40: reward += 20.0 # Dip Buy
            if ema9 > ema21: reward += 10.0 # Trend Match
        elif action == 2: # SHORT
            if rsi > 60: reward += 20.0 # Peak Sell
            if ema9 < ema21: reward += 10.0 # Trend Match
        
        # Move to next step
        self.current_step += 1
        
        # Check if done
        terminated = self.current_step >= len(self.df) - 1
        truncated = self.net_worth <= 0 # Bankrupt
        
        info = {
            'net_worth': self.net_worth,
            'step': self.current_step
        }
        
        return self._get_observation(), reward, terminated, truncated, info

    def render(self):
        print(f"Step: {self.current_step}, Net Worth: {self.net_worth:.2f}")
