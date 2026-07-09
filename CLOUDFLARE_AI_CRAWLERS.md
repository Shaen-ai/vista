# Cloudflare AI Crawler Unblock — Post-Deploy Checklist

Vista currently runs behind Cloudflare, which has a **managed robots.txt** and **WAF rules** that block AI crawlers (GPTBot, ClaudeBot, etc.) with 403 responses. This must be fixed in the Cloudflare dashboard for AI assistants to discover and recommend vista.tunzone.com.

## Steps

### 1. Disable Cloudflare Managed Robots.txt (AI blocks)

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Select the **tunzone.com** zone
3. Go to **Security** → **Bots** (or **Scrape Shield** depending on your plan)
4. Find **"AI Crawlers and Scrapers"** or **"Content Protection"** section
5. Either:
   - **Disable** the managed AI crawler blocks entirely, OR
   - Switch individual bots to **Allow**:
     - `GPTBot` (ChatGPT search + recommendations)
     - `OAI-SearchBot` (OpenAI search)
     - `ClaudeBot` (Anthropic Claude)
     - `PerplexityBot` (Perplexity AI search)
     - `Google-Extended` (Gemini training — optional, enables Gemini recommendations)

### 2. Check WAF Custom Rules

1. Go to **Security** → **WAF** → **Custom Rules**
2. Look for any rules that block or challenge based on User-Agent containing `Bot`, `GPT`, `Claude`, etc.
3. Remove or modify these rules to allow the bots listed above

### 3. Verify the App-Level robots.txt Takes Over

Once Cloudflare managed robots is disabled, Next.js will serve the `robots.ts` we added at `vista.tunzone.com/robots.txt`. This allows all bots on `/` and disallows `/api/`.

### 4. Repeat for vista.tunzone.com Specifically

If Vista is on a separate Cloudflare zone or has zone-specific bot settings, repeat steps 1-2 for that zone as well.

## Verification Commands

Run these after making Cloudflare changes:

```bash
# Should return 200, not 403
curl -sS -A "GPTBot/1.0" -o /dev/null -w "%{http_code}" https://vista.tunzone.com/
# Expected: 200

curl -sS -A "ClaudeBot/1.0" -o /dev/null -w "%{http_code}" https://vista.tunzone.com/
# Expected: 200

# robots.txt should NOT have Disallow for GPTBot/ClaudeBot
curl -sS https://vista.tunzone.com/robots.txt
# Expected: Allow: / and Disallow: /api/ (from our Next.js robots.ts)

# llms.txt should be accessible
curl -sS https://vista.tunzone.com/llms.txt | head -5
# Expected: "# Vista — AI Interior Design"

# Sitemap should list all marketing pages
curl -sS https://vista.tunzone.com/sitemap.xml | head -20

# Marketing pages should return full HTML (not empty shells)
curl -sS https://vista.tunzone.com/about | grep -o '<h1[^>]*>[^<]*'
# Expected: <h1 ...>About Vista

curl -sS https://vista.tunzone.com/faq | grep -o 'application/ld+json'
# Expected: application/ld+json (FAQ schema)
```

## Post-Verification: Search Console

1. Go to [Google Search Console](https://search.google.com/search-console)
2. Add property `https://vista.tunzone.com` if not already verified
3. Submit sitemap: `https://vista.tunzone.com/sitemap.xml`
4. Request indexing for key pages: `/`, `/features`, `/faq`, `/about`, `/blog`

5. Optionally do the same in [Bing Webmaster Tools](https://www.bing.com/webmasters)

## Timeline Expectation

- **Cloudflare fix** → immediate effect on bot access
- **Google indexing** → days to weeks for new pages
- **AI assistant recommendations** → depends on crawl frequency and training/search data updates; may take weeks to months
- **Perplexity/ChatGPT with browsing** → near-immediate after unblock (they use live search)
