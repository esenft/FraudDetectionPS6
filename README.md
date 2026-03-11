# FraudDetection PS-6

This project provides a runnable fraud-detection demo with the exact architecture requested:

- Input: list of 100 transactions in `data/transactions100.json`
- Chunking: split into 5 batches of 20
- Parallel Agent/LLM Calls: process all 5 batches concurrently
- Aggregation: append suspicious transactions into `data/suspiciousTransactions.json` via a `suspiciousTransactions` tool
- UI Monitoring: live feed of agent calls, tool calls, and suspicious transaction state

## Data Files

- `data/sampleData.json`: schema examples
- `data/transactions100.json`: generated dataset with 100 transactions
- `data/suspiciousTransactions.json`: accumulator/state file (starts as `[]`)

## How It Works

1. `POST /api/run` starts a detection run.
2. The server loads 100 transactions and validates the count.
3. Transactions are chunked into batches of 20.
4. All batches are sent in parallel for analysis:
	- Uses OpenAI if `OPENAI_API_KEY` is set.
	- Falls back to deterministic rule-based analysis if key/model call fails.
5. Each batch writes suspicious results through the `suspiciousTransactions` tool.
6. Tool writes update `data/suspiciousTransactions.json` and emit websocket events.
7. UI updates in near real time with:
	- Agent call stages
	- Tool call stages
	- Current suspicious transaction table

## Run Locally

1. Install dependencies:

```bash
npm install
```

2. Optional: configure OpenAI credentials:

```bash
cp .env.example .env
```

Set `OPENAI_API_KEY` in `.env` to use model-based analysis.

3. Start server:

```bash
npm start
```

4. Open the app:

- `http://localhost:3000`

## UI Controls

- `Run Detection`: process the 100 transactions (5x20 in parallel)
- `Reset State`: clears `data/suspiciousTransactions.json` to `[]`

## API Endpoints

- `GET /api/state`: fetch current suspicious state and latest run summary
- `POST /api/run`: launch detection
- `POST /api/reset`: clear accumulator state


