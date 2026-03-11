import fs from "fs/promises";

export class SuspiciousTransactionsTool {
  constructor({ outputPath, emitEvent }) {
    this.outputPath = outputPath;
    this.emitEvent = emitEvent;
    this.lock = Promise.resolve();
  }

  async initialize() {
    try {
      const existing = await fs.readFile(this.outputPath, "utf8");
      JSON.parse(existing || "[]");
    } catch {
      await fs.writeFile(this.outputPath, "[]\n", "utf8");
    }
  }

  async appendMany(items, metadata = {}) {
    if (!items.length) {
      return [];
    }

    this.emitEvent("tool-call", {
      tool: "suspiciousTransactions",
      action: "appendMany:start",
      count: items.length,
      batchId: metadata.batchId ?? null,
      timestamp: new Date().toISOString()
    });

    const operation = async () => {
      const existingRaw = await fs.readFile(this.outputPath, "utf8");
      const existing = JSON.parse(existingRaw || "[]");
      const merged = [...existing, ...items];
      await fs.writeFile(this.outputPath, JSON.stringify(merged, null, 2) + "\n", "utf8");

      this.emitEvent("tool-call", {
        tool: "suspiciousTransactions",
        action: "appendMany:done",
        count: items.length,
        total: merged.length,
        batchId: metadata.batchId ?? null,
        timestamp: new Date().toISOString()
      });

      return merged;
    };

    this.lock = this.lock.then(operation, operation);
    return this.lock;
  }
}
