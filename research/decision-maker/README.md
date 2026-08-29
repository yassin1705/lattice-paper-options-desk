# Decision-maker research notebook

This research harness invokes the production TypeScript `DecisionMakerAgent`. It does not
reimplement indicators or strategy rules in Python, and it never submits Alpaca orders.

From the project root, prepare and open the local notebook with:

```powershell
python -m pip install -r research/decision-maker/requirements.txt
python -m jupyter lab research/decision-maker/decision-maker.ipynb
```

Open `decision-maker.ipynb`, edit the configuration cell, and run the cells in order. The
notebook writes disposable JSON reports to `outputs/`, which is excluded from Git.
Its first code cell installs the small Python dependency list for tables and charts into the
active notebook kernel.

The initial backtest is a directional signal test on the underlying asset. It reports future
underlying returns rather than option P&L because realistic option backtesting requires
historical chains, bid/ask execution, expiration handling, and exit rules.

The runner defaults to Alpaca's `iex` stock-data feed, which is available to paper/free
accounts. You can override it with `--feed` if the account has another market-data plan.

The same runner is also available from the project root:

```powershell
npm run decision:backtest -- --symbol SPY --start 2025-01-01 --end 2026-07-31 --timeframe 1Day --lookback 100 --step 1 --horizons 1,3,5 --feed iex --output research/decision-maker/outputs/spy.json
```
