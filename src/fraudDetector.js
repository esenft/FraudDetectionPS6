import OpenAI from "openai";

const BATCH_SIZE = 20;

const SYSTEM_PROMPT = [
  "You are a fraud detection analyst.",
  "Return only strict JSON with key suspiciousTransactions.",
  "Each suspicious transaction must include id, accountId, amount, reason, riskScore.",
  "riskScore must be an integer from 1 to 100.",
  "Flag transactions that are likely fraudulent due to unusual amount, geography, channel, device novelty, or risky merchant patterns."
].join(" ");

function ruleBasedAnalyze(transactions) {
  const suspicious = [];

  for (const txn of transactions) {
    const reasons = [];

    if (txn.amount >= 2500) {
      reasons.push("high_amount");
    }

    if (typeof txn.location === "string" && /unknown|vpn|lagos|moscow|bucharest/i.test(txn.location)) {
      reasons.push("high_risk_location");
    }

    if (typeof txn.channel === "string" && /online_transfer|card_not_present/i.test(txn.channel)) {
      reasons.push("remote_payment_channel");
    }

    if (typeof txn.merchant === "string" && /crypto|offshore|giftcard|luxury/i.test(txn.merchant)) {
      reasons.push("risky_merchant_pattern");
    }

    if (typeof txn.deviceId === "string" && /dev_new/i.test(txn.deviceId)) {
      reasons.push("new_or_unknown_device");
    }

    if (!reasons.length) {
      continue;
    }

    const riskScore = Math.min(100, 35 + reasons.length * 14);
    suspicious.push({
      id: txn.id,
      accountId: txn.accountId,
      amount: txn.amount,
      reason: reasons.join(","),
      riskScore,
      transaction: txn
    });
  }

  return suspicious;
}

async function llmAnalyze(client, model, transactions) {
  const response = await client.chat.completions.create({
    model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: JSON.stringify({ transactions })
      }
    ]
  });

  const text = response.choices?.[0]?.message?.content ?? "{}";
  const parsed = JSON.parse(text);
  const suspicious = Array.isArray(parsed.suspiciousTransactions) ? parsed.suspiciousTransactions : [];

  return suspicious.map((item) => ({
    id: item.id,
    accountId: item.accountId,
    amount: Number(item.amount ?? 0),
    reason: item.reason ?? "llm_flagged",
    riskScore: Number(item.riskScore ?? 50),
    transaction: transactions.find((t) => t.id === item.id) ?? null
  }));
}

export function chunkTransactions(transactions) {
  const chunks = [];
  for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
    chunks.push(transactions.slice(i, i + BATCH_SIZE));
  }
  return chunks;
}

export class FraudDetector {
  constructor({ apiKey, model = "gpt-4.1-mini", emitEvent, suspiciousTool }) {
    this.model = model;
    this.emitEvent = emitEvent;
    this.suspiciousTool = suspiciousTool;
    this.client = apiKey ? new OpenAI({ apiKey }) : null;
  }

  async processBatch(batch, batchId) {
    this.emitEvent("agent-call", {
      stage: "start",
      batchId,
      txCount: batch.length,
      model: this.client ? this.model : "rule-based-fallback",
      timestamp: new Date().toISOString()
    });

    let suspicious = [];
    try {
      if (this.client) {
        suspicious = await llmAnalyze(this.client, this.model, batch);
      } else {
        suspicious = ruleBasedAnalyze(batch);
      }
    } catch (error) {
      this.emitEvent("agent-call", {
        stage: "error",
        batchId,
        message: String(error.message || error),
        fallback: "rule-based",
        timestamp: new Date().toISOString()
      });
      suspicious = ruleBasedAnalyze(batch);
    }

    const enriched = suspicious
      .filter((item) => item?.id)
      .map((item) => ({
        ...item,
        batchId,
        detectedAt: new Date().toISOString()
      }));

    if (enriched.length) {
      await this.suspiciousTool.appendMany(enriched, { batchId });
      this.emitEvent("suspicious-detected", {
        batchId,
        count: enriched.length,
        ids: enriched.map((s) => s.id),
        timestamp: new Date().toISOString()
      });
    }

    this.emitEvent("agent-call", {
      stage: "done",
      batchId,
      suspiciousCount: enriched.length,
      timestamp: new Date().toISOString()
    });

    return {
      batchId,
      suspicious: enriched,
      total: batch.length
    };
  }

  async run(transactions) {
    const chunks = chunkTransactions(transactions);
    this.emitEvent("run-status", {
      stage: "chunked",
      chunks: chunks.length,
      batchSize: BATCH_SIZE,
      totalTransactions: transactions.length,
      timestamp: new Date().toISOString()
    });

    const results = await Promise.all(chunks.map((batch, index) => this.processBatch(batch, index + 1)));

    const suspiciousTotal = results.reduce((sum, item) => sum + item.suspicious.length, 0);
    this.emitEvent("run-status", {
      stage: "completed",
      chunks: chunks.length,
      suspiciousTotal,
      timestamp: new Date().toISOString()
    });

    return {
      totalTransactions: transactions.length,
      chunks: chunks.length,
      suspiciousTotal,
      results
    };
  }
}
