# Public 24-hour paper-trading demo

The deadline deployment keeps the complete trading system on one computer and
publishes only the dashboard through Cloudflare Tunnel. Alpaca credentials,
SQLite, the autonomous runner, and Ollama remain local. Requests arriving on
the public hostname are read-only; agent and risk controls work only from
`http://localhost:3000`.

## One-time preparation

1. Install and start Ollama, then pull the configured model:
   `ollama pull qwen3:8b`.
2. Install the local Cloudflare Tunnel binary:
   `npm run public:install-tunnel`.
3. Build the dashboard: `npm run build`.
4. Set the following in `.env.local` for an unattended run:

   ```env
   ALPACA_EXPECTED_ACCOUNT_ID=your-paper-account-id
   AUTONOMOUS_RUNNER_AUTO_START=true
   AUTONOMOUS_EXECUTION_ENABLED=true
   TECHNICAL_STRATEGY_ENABLED=true
   NEWS_STRATEGY_ENABLED=true
   NEWS_SYMBOLS=NVDA,AAPL,MSFT,AMZN,META
   OLLAMA_MODEL_NAME=qwen3:8b
   OLLAMA_TIMEOUT_MS=300000
   ```

## Start the public demo

Run `npm run public:demo`. Without a tunnel token, cloudflared prints a
temporary `trycloudflare.com` URL. Keep the terminal and computer running and
disable sleep for the 24-hour experiment.

For a stable hostname, create a named tunnel in Cloudflare, route the hostname
to `http://localhost:3000`, and store its token only in `.env.local` as
`CLOUDFLARED_TUNNEL_TOKEN`. Never commit that token.

The supervisor restarts the dashboard or tunnel after an unexpected exit. The
environment defaults restore the enabled strategies, and the local launcher
automatically starts the autonomous runner after the dashboard is healthy.
