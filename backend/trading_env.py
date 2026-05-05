import gymnasium as gym
from gymnasium import spaces
import numpy as np

class CryptoTradingEnv(gym.Env):
    """
    Institutional Grade Trading Environment with 2% Max Risk & SL/TP Management.
    """
    metadata = {'render_modes': ['human']}

    def __init__(self, df, initial_balance=5000):
        super(CryptoTradingEnv, self).__init__()
        
        self.df = df
        self.symbol = "BTCUSDT"
        self.initial_balance = initial_balance
        self.fee_percent = 0.001 
        
        # Risk Management Parameters
        self.max_risk_pct = 0.02      # 2% of account max loss per trade
        self.position_pct = 0.05      # 5% of account per position
        self.rr_ratio = 1.5           # Reward:Risk
        self.stop_pct = 0.005         # 0.5% stop loss from entry
        
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
        
        return self._get_observation(), {}

    def _get_observation(self):
        # Current row of data
        obs = self.df.iloc[self.current_step].values.tolist()
        # Add account state
        obs.extend([self.balance, self.crypto_held])
        return np.array(obs, dtype=np.float32)

    def _calculate_sl_tp(self, entry_price, action):
        if action == 1: # LONG
            stop_price = entry_price * (1 - self.stop_pct)
            tp_price = entry_price * (1 + self.stop_pct * self.rr_ratio)
        else: # SHORT
            stop_price = entry_price * (1 + self.stop_pct)
            tp_price = entry_price * (1 - self.stop_pct * self.rr_ratio)
        return stop_price, tp_price

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
        
        # Execute Action with Risk Management
        if action != 0 and self.crypto_held == 0:
            stop, tp = self._calculate_sl_tp(current_price, action)
            position_usd = self._calculate_position_size(current_price, stop, action)
            
            if position_usd >= 20: # Minimum trade size
                fee = position_usd * self.fee_percent
                self.balance -= (position_usd + fee)
                self.crypto_held = position_usd / current_price
                self.entry_price = current_price
                self.stop_loss = stop
                self.take_profit = tp
                self.trade_direction = action
        
        # Check SL/TP if in position
        if self.crypto_held > 0:
            if self.trade_direction == 1: # LONG
                if current_price <= self.stop_loss or current_price >= self.take_profit:
                    self.balance += (self.crypto_held * current_price) * (1 - self.fee_percent)
                    self.crypto_held = 0
            else: # SHORT (Simplified)
                if current_price >= self.stop_loss or current_price <= self.take_profit:
                    # Profit = (Entry - Exit) * Units
                    profit = (self.entry_price - current_price) * self.crypto_held
                    self.balance += (self.entry_price * self.crypto_held + profit) * (1 - self.fee_percent)
                    self.crypto_held = 0
                
        # Calculate new net worth
        last_net_worth = self.net_worth
        self.net_worth = self.balance + (self.crypto_held * current_price)
        self.max_net_worth = max(self.net_worth, self.max_net_worth)
        
        # Calculate Reward
        # Greed Hack: We multiply the net worth change by 1000 to make profit
        # extremely attractive to the neural network.
        net_worth_change = (self.net_worth - last_net_worth) / last_net_worth
        
        reward = net_worth_change * 1000 
        
        # Aggressive Inactivity Penalty: Force the agent to take risks
        if action == 0 and self.crypto_held == 0:
            reward -= 0.1 
        
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
