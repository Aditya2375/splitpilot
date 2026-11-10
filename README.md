# SplitPilot

Say what happened, like you would in a group chat. SplitPilot works out who owes what, creates one **PayPal Sandbox** checkout per person, and tracks who has paid.

> "I paid $84 for pizza with Rahul, Meera and Dev"  ->  three PayPal checkouts of $21.00, each with its own pay link.

Built for the PayPal AI Hackathon (agentic commerce: an AI agent that turns a sentence into real payment requests).

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

## License

MIT
