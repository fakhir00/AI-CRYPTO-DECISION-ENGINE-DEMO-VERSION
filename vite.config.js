import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  
  const openaiKey = env.VITE_OPENAI_API_KEY || env.OPENAI_API_KEY || '';
  const groqKey   = env.VITE_GROQ_API_KEY   || env.GROQ_API_KEY   || '';

  return {
    server: {
      proxy: {
        '/api/cmc': {
          target: 'https://pro-api.coinmarketcap.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/cmc/, '')
        },
        // OpenAI — conversational AI chat
        '/api/chat': {
          target: 'https://api.openai.com',
          changeOrigin: true,
          rewrite: () => '/v1/chat/completions',
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              if (openaiKey) proxyReq.setHeader('Authorization', `Bearer ${openaiKey}`);
            });
          }
        },
        // Groq Hermes — quantitative prediction engine
        '/api/hermes': {
          target: 'https://api.groq.com',
          changeOrigin: true,
          rewrite: () => '/openai/v1/chat/completions',
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              if (groqKey) proxyReq.setHeader('Authorization', `Bearer ${groqKey}`);
            });
          }
        }
      }
    }
  };
});
