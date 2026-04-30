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
          target: 'https://api.openai.com/v1/chat/completions',
          changeOrigin: true,
          rewrite: (path) => '',
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
