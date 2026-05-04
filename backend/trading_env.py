import gymnasium as gym
from gymnasium import spaces
import numpy as np

class CryptoTradingEnv(gym.Env):
    """
    A custom trading environment for Reinforcement Learning using Gymnasium.
    """
    metadata = {'render_modes': ['human']}

    def __init__(self, df, initial_balance=10000):
        super(CryptoTradingEnv, self).__init__()
        
        self.df = df
        self.initial_balance = initial_balance
        self.fee_percent = 0.001 # 0.1% Binance spot fee
        
        # Actions: 0 = Hold, 1 = Buy, 2 = Sell
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

    def step(self, action):
        current_price = self.df.iloc[self.current_step]['close']
        
        # Execute action
        if action == 1: # Buy
            if self.balance > 0:
                crypto_bought = (self.balance * (1 - self.fee_percent)) / current_price
                self.crypto_held += crypto_bought
                self.balance = 0
        elif action == 2: # Sell
            if self.crypto_held > 0:
                usd_gained = (self.crypto_held * current_price) * (1 - self.fee_percent)
                self.balance += usd_gained
                self.crypto_held = 0
                
        # Calculate new net worth
        self.net_worth = self.balance + (self.crypto_held * current_price)
        self.max_net_worth = max(self.net_worth, self.max_net_worth)
        
        # Calculate Reward (Change in net worth)
        reward = self.net_worth - self.initial_balance
        
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
