import type { APIRoute } from "astro";

const indexable = import.meta.env.PUBLIC_INDEXABLE === "true";

const getRobotsTxt = (sitemapURL: URL) => `
User-agent: *
${indexable ? "Allow: /" : "Disallow: /"}

Sitemap: ${sitemapURL.href}
`;

export const GET: APIRoute = ({ site }) => {
  const sitemapURL = new URL("sitemap-index.xml", site);
  return new Response(getRobotsTxt(sitemapURL));
};
