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
        self.obs_columns = [c for c in self.df.columns if not c.startswith('raw_') and c not in ['high', 'low']]
        self.observation_space = spaces.Box(
            low=-np.inf, high=np.inf, shape=(len(self.obs_columns) + 2,), dtype=np.float32
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
        obs = self.df.iloc[self.current_step][self.obs_columns].values.tolist()
        # Add account state
        obs.extend([self.balance, self.crypto_held])
        return np.array(obs, dtype=np.float32)

    def _calculate_sl_tp_v5(self, entry_price, action, atr, row):
        # Dynamic SL based on ATR
        sl_dist = atr * self.sl_atr
        
        # Resistance-Based TP (Using Local Res/Pivot)
        if action == 1: # LONG
            stop_price = entry_price - sl_dist
            tp1_price = max(entry_price + (atr * 0.5), row['raw_res1']) # At least 0.5 ATR or Pivot Res
            tp2_price = max(tp1_price + (atr * 1.0), row['raw_local_res']) # Second target at Local High
        else: # SHORT
            stop_price = entry_price + sl_dist
            tp1_price = min(entry_price - (atr * 0.5), row['raw_sup1']) # At least 0.5 ATR or Pivot Sup
            tp2_price = min(tp1_price - (atr * 1.0), row['raw_local_sup']) # Second target at Local Low
            
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
        row = self.df.iloc[self.current_step]
        current_price = row['close']
        high_price = row['high']
        low_price = row['low']
        last_price = self.df.iloc[self.current_step-1]['close']
        prev_held = self.crypto_held
        prev_net_worth = self.net_worth
        
        # Execute Action with v5.0 Resistance-Based Geometry
        if action != 0 and self.crypto_held == 0:
            row = self.df.iloc[self.current_step]
            stop, tp1, tp2 = self._calculate_sl_tp_v5(current_price, action, row['raw_atr'], row)
            position_usd = self._calculate_position_size(current_price, stop, action)
            
            if (action == 1 and row['raw_ema_9'] < row['raw_ema_21']) or (action == 2 and row['raw_ema_9'] > row['raw_ema_21']):
                action = 0 # Trend Lock
            
            if action != 0 and position_usd >= 5: 
                fee = position_usd * self.fee_percent
                self.balance_before_trade = self.balance
                self.initial_position_value = position_usd
                self.balance -= (position_usd + fee)
                self.crypto_held = position_usd / current_price
                self.entry_price = current_price
                self.stop_loss = stop
                self.tp1 = tp1
                self.tp2 = tp2
                self.trade_direction = action
                self.partial_profit_taken = False
                just_entered = True
        else:
            just_entered = False
        
        self.t1_hit_this_step = False
        trade_just_closed = False
        
        # Check SL/TP if in position
        if self.crypto_held > 0 and not just_entered:
            if self.trade_direction == 1: # LONG
                hit_sl = low_price <= self.stop_loss
                hit_tp1 = high_price >= self.tp1 and not self.partial_profit_taken
                hit_tp2 = high_price >= self.tp2

                if hit_sl:
                    self.balance += (self.crypto_held * self.stop_loss) * (1 - self.fee_percent)
                    self.crypto_held = 0
                    trade_just_closed = True
                else:
                    if hit_tp1:
                        sell_amount = (self.crypto_held * 0.5) * self.tp1 * (1 - self.fee_percent)
                        self.balance += sell_amount
                        self.crypto_held *= 0.5
                        self.partial_profit_taken = True
                        self.t1_hit_this_step = True
                        self.stop_loss = current_price - (row['raw_atr'] * self.trailing_sl_multiplier)

                    if hit_tp2:
                        self.balance += (self.crypto_held * self.tp2) * (1 - self.fee_percent)
                        self.crypto_held = 0
                        trade_just_closed = True

                    if self.partial_profit_taken and self.crypto_held > 0:
                        new_sl = current_price - (row['raw_atr'] * self.trailing_sl_multiplier)
                        if new_sl > self.stop_loss:
                            self.stop_loss = new_sl
            else: # SHORT
                hit_sl = high_price >= self.stop_loss
                hit_tp1 = low_price <= self.tp1 and not self.partial_profit_taken
                hit_tp2 = low_price <= self.tp2

                if hit_sl:
                    profit = (self.entry_price - self.stop_loss) * self.crypto_held
                    self.balance += (self.entry_price * self.crypto_held + profit) * (1 - self.fee_percent)
                    self.crypto_held = 0
                    trade_just_closed = True
                else:
                    if hit_tp1:
                        profit = (self.entry_price - self.tp1) * (self.crypto_held * 0.5)
                        self.balance += (self.entry_price * (self.crypto_held * 0.5) + profit) * (1 - self.fee_percent)
                        self.crypto_held *= 0.5
                        self.partial_profit_taken = True
                        self.t1_hit_this_step = True
                        self.stop_loss = current_price + (row['atr'] * self.trailing_sl_multiplier)

                    if hit_tp2:
                        profit = (self.entry_price - self.tp2) * self.crypto_held
                        self.balance += (self.entry_price * self.crypto_held + profit) * (1 - self.fee_percent)
                        self.crypto_held = 0
                        trade_just_closed = True

                    if self.partial_profit_taken and self.crypto_held > 0:
                        new_sl = current_price + (row['atr'] * self.trailing_sl_multiplier)
                        if new_sl < self.stop_loss:
                            self.stop_loss = new_sl
                
        # Calculate new net worth
        last_net_worth = self.net_worth
        self.net_worth = self.balance + (self.crypto_held * current_price)
        self.max_net_worth = max(self.net_worth, self.max_net_worth)
        
        # --- v12.0 INSTITUTIONAL SNIPER REWARD ENGINE ---
        reward = 0
        
        # 1. Realized PnL Reward (The most important for profitability)
        if trade_just_closed:
            trade_pnl_usd = self.balance - self.balance_before_trade
            pnl_pct = (trade_pnl_usd / self.initial_position_value) * 100
            
            if pnl_pct > 0:
                # Quadratic reward for wins (incentivize big wins)
                reward += (pnl_pct ** 2) * 2.0 
                # Massive bonus for high R:R wins
                if pnl_pct > 3.0: reward += 50.0 
            else:
                # Severe penalty for losses (3x more weight than wins)
                reward += pnl_pct * 15.0 
                
        # 2. Unrealized Momentum Reward
        if self.crypto_held > 0:
            price_change = (current_price - last_price) / last_price
            if self.trade_direction == 1: # LONG
                reward += price_change * 50.0
            else: # SHORT
                reward -= price_change * 50.0
                
        # 3. HOLD / SELECTIVITY Reward
        if action == 0 and self.crypto_held == 0:
            # Reward staying out during high volatility or uncertainty
            volatility = abs((high_price - low_price) / current_price)
            if volatility > 0.02: # 2% candle
                reward += 2.0 # Good job sitting on hands during chaos
            else:
                reward += 0.1 # Tiny reward for patience
                
        # 4. Hitting TP1 (Partial Profit)
        if getattr(self, 't1_hit_this_step', False):
            reward += 15.0
            
        # 5. Drawdown Penalty
        drawdown = (self.max_net_worth - self.net_worth) / self.max_net_worth
        if drawdown > 0.05: # >5% Drawdown
            reward -= (drawdown * 100.0)

        # Move to next step
        self.current_step += 1
        
        # Check if done
        terminated = self.current_step >= len(self.df) - 1
        truncated = self.net_worth <= (self.initial_balance * 0.5) # Bankruptcy at 50% drawdown
        
        info = {
            'net_worth': self.net_worth,
            'step': self.current_step,
            'reward': reward
        }
        
        if trade_just_closed:
            trade_pnl_usd = self.balance - self.balance_before_trade
            info['trade_closed'] = True
            info['trade_pnl_pct'] = (trade_pnl_usd / self.initial_position_value) * 100
        
        return self._get_observation(), reward, terminated, truncated, info

    def render(self):
        print(f"Step: {self.current_step}, Net Worth: {self.net_worth:.2f}")
