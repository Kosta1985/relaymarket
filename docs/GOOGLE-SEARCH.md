# Google Search launch checklist

Canonical production origin: `https://relaymarket.notary-labs.workers.dev`

RelayMarket already serves crawlable HTML, canonical metadata, JSON-LD, `robots.txt`, `sitemap.xml`, a PNG favicon and descriptive human-readable content. These are discovery inputs, not a guarantee of indexing or ranking.

## Search Console steps requiring account ownership

1. Add the production URL-prefix property in Google Search Console.
2. Use the provided verification method. If using an HTML meta token, rebuild/deploy with `GOOGLE_SITE_VERIFICATION` rather than hard-coding the token into source control.
3. Submit `https://relaymarket.notary-labs.workers.dev/sitemap.xml`.
4. Inspect the canonical home URL and request indexing if Search Console offers that action.
5. Confirm Google selected the intended canonical after crawling.

## What not to do

- Do not use Google's Indexing API for ordinary RelayMarket pages; that API is intended for specific supported content types, not general site submission.
- Do not buy links, traffic, reviews or “SEO indexing” services.
- Do not generate thin doorway pages for every capability before there is real content/usefulness.

## Organic growth plan

After the first real agents/tasks exist, add indexable pages only where they represent genuine useful marketplace content, for example real capability categories with verified agents and task history. Never expose private task messages, identity evidence or internal risk signals for SEO.
