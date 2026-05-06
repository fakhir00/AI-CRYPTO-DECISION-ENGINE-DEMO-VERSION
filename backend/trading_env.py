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
        
        # v4.5 Ultra-Accuracy Geometry (Target 80%+)
        self.max_risk_pct = 0.01      
        self.position_pct = 0.15      # Increased size for high-conviction scalps
        self.sl_atr = 1.2             # Wider SL to avoid noise shakeouts
        self.tp1_atr = 0.7            # Lowered T1 for high-probability wins
        self.tp2_atr = 3.0            # T2 for trend runners
        
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

    def _calculate_sl_tp_v4(self, entry_price, action, atr):
        # v4.0 Scaling Out Geometry
        sl_dist = atr * self.sl_atr
        tp1_dist = atr * self.tp1_atr
        tp2_dist = atr * self.tp2_atr
        
        if action == 1: # LONG
            stop_price = entry_price - sl_dist
            tp1_price = entry_price + tp1_dist
            tp2_price = entry_price + tp2_dist
        else: # SHORT
            stop_price = entry_price + sl_dist
            tp1_price = entry_price - tp1_dist
            tp2_price = entry_price - tp2_dist
            
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
        
        # Execute Action with v4.0 Geometry & Institutional Trend Filter
        if action != 0 and self.crypto_held == 0:
            ema9 = self.df.iloc[self.current_step]['ema_9']
            ema21 = self.df.iloc[self.current_step]['ema_21']
            
            # Trend Filter: Block Longs if Bearish, Block Shorts if Bullish
            if (action == 1 and ema9 < ema21) or (action == 2 and ema9 > ema21):
                action = 0 # Force Hold if trend is against us
            
            if action != 0:
                atr = self.df.iloc[self.current_step]['atr']
                stop, tp1, tp2 = self._calculate_sl_tp_v4(current_price, action, atr)
                position_usd = self._calculate_position_size(current_price, stop, action)
                
                if position_usd >= 20: 
                    fee = position_usd * self.fee_percent
                    self.balance -= (position_usd + fee)
                    self.crypto_held = position_usd / current_price
                    self.entry_price = current_price
                    self.stop_loss = stop
                    self.tp1 = tp1
                    self.tp2 = tp2
                    self.trade_direction = action
                    self.partial_profit_taken = False
        
        # Check SL/TP if in position
        if self.crypto_held > 0:
            if self.trade_direction == 1: # LONG
                # 1. Partial Profit Taking (T1)
                if not self.partial_profit_taken and current_price >= self.tp1:
                    # Sell 50%
                    sell_amount = (self.crypto_held * 0.5) * current_price * (1 - self.fee_percent)
                    self.balance += sell_amount
                    self.crypto_held *= 0.5
                    self.partial_profit_taken = True
                    # Move SL to Entry (Risk-Free)
                    self.stop_loss = self.entry_price 
                
                # 2. Final TP (T2) or SL
                if current_price <= self.stop_loss or current_price >= self.tp2:
                    self.balance += (self.crypto_held * current_price) * (1 - self.fee_percent)
                    self.crypto_held = 0
            else: # SHORT
                # 1. Partial Profit Taking (T1)
                if not self.partial_profit_taken and current_price <= self.tp1:
                    profit = (self.entry_price - current_price) * (self.crypto_held * 0.5)
                    self.balance += (self.entry_price * (self.crypto_held * 0.5) + profit) * (1 - self.fee_percent)
                    self.crypto_held *= 0.5
                    self.partial_profit_taken = True
                    self.stop_loss = self.entry_price
                
                # 2. Final TP (T2) or SL
                if current_price >= self.stop_loss or current_price <= self.tp2:
                    profit = (self.entry_price - current_price) * self.crypto_held
                    self.balance += (self.entry_price * self.crypto_held + profit) * (1 - self.fee_percent)
                    self.crypto_held = 0
                
        # Calculate new net worth
        last_net_worth = self.net_worth
        self.net_worth = self.balance + (self.crypto_held * current_price)
        self.max_net_worth = max(self.net_worth, self.max_net_worth)
        
        # Calculate Reward
        net_worth_change = (self.net_worth - last_net_worth) / last_net_worth
        
        # 1. Base Profit Reward (Non-linear for high conviction)
        if net_worth_change > 0:
            reward = (net_worth_change * 20000) ** 1.1 # Stronger pull for gains
        else:
            reward = net_worth_change * 15000 # Proportional penalty
        
        # 2. Win Bonus (Hit Rate focus)
        if net_worth_change > 0.001: 
            reward += 15.0
            
        # 3. Loss Penalty (Strict but fair)
        if net_worth_change < -0.005:
            reward -= 30.0 
            
        # 4. Consistency & Peak Reward
        if self.net_worth > self.max_net_worth:
            reward += 10.0 
            self.max_net_worth = self.net_worth
            
        # 5. Accuracy Alignment: Penalize churning
        if action != 0 and abs(net_worth_change) < 0.0001:
            reward -= 2.0 
        
        # 6. Market Engagement: Penalize extreme stagnation (CRITICAL)
        if action == 0 and self.crypto_held == 0:
            reward -= 0.5 # Much higher penalty to force the agent to find a move
        
        # 7. Holding Reward: Encourage staying in profit
        if self.crypto_held > 0 and net_worth_change > 0:
            reward += 1.0 
            
        # 8. v4.5 Ultra-Accuracy Reward (Priority: Winning Trades)
        if self.partial_profit_taken:
            reward += 100.0 # MASSIVE reward for securing the win (T1)
            
        # 9. Signal Alignment Reward (Heuristic Guidance)
        rsi = self.df.iloc[self.current_step-1]['rsi']
        ema9 = self.df.iloc[self.current_step-1]['ema_9']
        ema21 = self.df.iloc[self.current_step-1]['ema_21']
        
        if action == 1: # LONG
            if rsi < 45: reward += 10.0 # Success Pattern
            if ema9 > ema21: reward += 5.0 # Trend Alignment
            if rsi > 65: reward -= 25.0 # FOMO Penalty
        elif action == 2: # SHORT
            if rsi > 55: reward += 10.0 # Success Pattern
            if ema9 < ema21: reward += 5.0 # Trend Alignment
            if rsi < 35: reward -= 25.0 # FOMO Penalty
        
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
