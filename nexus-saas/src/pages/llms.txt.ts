export const GET = ({ site }) => {
  return new Response(
    `Site: NEXUS AI Crypto\nContact: fakhir@example.com\nPolicy: AI bots allowed.\nSitemap: ${new URL('sitemap-index.xml', site).href}`
  );
};
