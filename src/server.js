import "dotenv/config";
import fs from "fs/promises";
import path from "path";
import express from "express";
import { WebSocketServer } from "ws";
import { fileURLToPath } from "url";
import { FraudDetector } from "./fraudDetector.js";
import { SuspiciousTransactionsTool } from "./suspiciousTransactionsTool.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const dataPath = path.join(rootDir, "data", "transactions100.json");
const suspiciousPath = path.join(rootDir, "data", "suspiciousTransactions.json");
const port = Number(process.env.PORT || 3000);

const app = express();
app.use(express.json());
app.use(express.static(path.join(rootDir, "public")));

const clients = new Set();
let runInProgress = false;
let latestRun = null;

const emitEvent = (type, payload) => {
  const event = {
    type,
    payload,
    ts: new Date().toISOString()
  };

  for (const ws of clients) {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify(event));
    }
  }
};

const suspiciousTool = new SuspiciousTransactionsTool({
  outputPath: suspiciousPath,
  emitEvent
});

await suspiciousTool.initialize();

app.get("/api/state", async (_req, res) => {
  const raw = await fs.readFile(suspiciousPath, "utf8");
  const suspiciousTransactions = JSON.parse(raw || "[]");
  res.json({
    suspiciousTransactions,
    latestRun,
    runInProgress
  });
});

app.post("/api/reset", async (_req, res) => {
  await fs.writeFile(suspiciousPath, "[]\n", "utf8");
  latestRun = null;
  emitEvent("run-status", {
    stage: "reset",
    timestamp: new Date().toISOString()
  });
  res.json({ ok: true });
});

app.post("/api/run", async (_req, res) => {
  if (runInProgress) {
    res.status(409).json({
      ok: false,
      message: "Run already in progress"
    });
    return;
  }

  runInProgress = true;
  emitEvent("run-status", {
    stage: "started",
    timestamp: new Date().toISOString()
  });

  try {
    const raw = await fs.readFile(dataPath, "utf8");
    const transactions = JSON.parse(raw || "[]");

    if (transactions.length !== 100) {
      throw new Error(`Expected 100 transactions, received ${transactions.length}`);
    }

    const detector = new FraudDetector({
      apiKey: process.env.OPENAI_API_KEY,
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      emitEvent,
      suspiciousTool
    });

    latestRun = await detector.run(transactions);
    res.json({ ok: true, summary: latestRun });
  } catch (error) {
    emitEvent("run-status", {
      stage: "error",
      message: String(error.message || error),
      timestamp: new Date().toISOString()
    });
    res.status(500).json({ ok: false, message: String(error.message || error) });
  } finally {
    runInProgress = false;
  }
});

const server = app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Fraud monitor running at http://localhost:${port}`);
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  clients.add(ws);
  ws.send(
    JSON.stringify({
      type: "run-status",
      payload: {
        stage: "connected",
        runInProgress,
        timestamp: new Date().toISOString()
      },
      ts: new Date().toISOString()
    })
  );

  ws.on("close", () => {
    clients.delete(ws);
  });
});
