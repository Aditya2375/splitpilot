# SplitPilot

Say what happened, like you would in a group chat. SplitPilot works out who owes what, creates one **PayPal Sandbox** checkout per person, and tracks who has paid.

> "I paid $84 for pizza with Rahul, Meera and Dev"  ->  three PayPal checkouts of $21.00, each with its own pay link.

Live demo: https://splitpilot-x0p8.onrender.com (free host, first load can take up to a minute while it wakes).

## Two modes, stated honestly

- **Sandbox mode**: when `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` (PayPal Sandbox app) are set, each share becomes a real PayPal Sandbox order with an approval link, and paying captures it.
- **Demo mode** (the hosted demo): no PayPal keys. Orders are labelled `MOCK-...` and "Simulate payment" stands in for the PayPal approval screen. The PayPal client in `paypal.js` has not been exercised against the live Sandbox API in this repo's hosted demo, so treat Sandbox mode as untested until you run it with your own keys.

## How it works

1. **AI step** (`parser.js`): an LLM turns free text into a structured plan (total, currency, who paid, who shares, ratios or fixed amounts). Works with any OpenAI-compatible endpoint (Gemini by default). Without a key a rule-based parser handles simple sentences.
2. **Split step** (`split.js`): deterministic integer math. Shares always add up to the exact total, no float drift. The LLM never does arithmetic.
3. **PayPal step** (`paypal.js`): one Orders v2 checkout per person who owes money (`/v2/checkout/orders`), then capture when they approve.
4. **Ledger**: stored in the browser, so the server holds no user data.

## Run it

```bash
git clone https://github.com/Aditya2375/splitpilot
cd splitpilot
export PAYPAL_CLIENT_ID=...        # PayPal Sandbox REST app
export PAYPAL_CLIENT_SECRET=...
export LLM_API_KEY=...             # optional, any OpenAI-compatible key (Gemini by default)
npm start                          # http://localhost:3000
npm test
```

No Node dependencies to install (Node 18+). With no PayPal keys it runs in a clearly labelled demo mode with fake order IDs.

| Variable | Default | Purpose |
|---|---|---|
| `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` | none | PayPal Sandbox app credentials |
| `LLM_API_KEY` | none | Enables the LLM parser |
| `LLM_URL` | Gemini OpenAI-compatible endpoint | Any OpenAI-compatible endpoint |
| `LLM_MODEL` | `gemini-flash-lite-latest,gemini-3-flash-preview` | Comma list, tried in order |

## Tools used

- PayPal Sandbox REST API (OAuth2, Orders v2 create + capture)
- Google Gemini (free tier, OpenAI-compatible endpoint) for language understanding
- Node.js standard library only

## Security notes

- LLM output and browser input are untrusted: `validate.js` strips names, caps people (20) and total (10,000), whitelists currencies, and rejects bad plans. The server recomputes every split itself.
- The message is passed to the model as data with an instruction to ignore embedded commands; even if that fails, validation and deterministic math bound what it can do.
- Strict CSP, no inline scripts, per-IP rate limits, request size cap, order IDs checked by pattern, redirect URLs built from `PUBLIC_URL` or a validated Host header.
- No database and no accounts: the ledger lives in your browser's localStorage. No secrets are stored in the repo.
- Not production payments software: no login, so anyone with the link can create sandbox orders (rate limited).

## License

MIT
