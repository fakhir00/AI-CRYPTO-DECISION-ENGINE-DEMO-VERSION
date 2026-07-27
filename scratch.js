import handler from './api/market.js';
const req = { query: {} };
const res = {
  setHeader: () => {},
  status: (code) => ({
    json: (data) => console.log(`Status: ${code}`, data)
  }),
  json: (data) => console.log(data)
};
handler(req, res).catch(console.error);
