import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    server: {
      proxy: {
        '/api/cmc': {
          target: 'https://pro-api.coinmarketcap.com',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/cmc/, '')
        },
        '/api/chat': {
          target: 'https://api.openai.com',
          changeOrigin: true,
          rewrite: (path) => '/v1/chat/completions',
          configure: (proxy, options) => {
            proxy.on('proxyReq', (proxyReq, req, res) => {
              proxyReq.setHeader('Authorization', `Bearer ${env.OPENAI_API_KEY}`);
            });
          }
        }
      }
    }
  };
});
