const runBtn = document.getElementById("runBtn");
const resetBtn = document.getElementById("resetBtn");
const eventsEl = document.getElementById("events");
const suspiciousBody = document.getElementById("suspiciousBody");
const summaryEl = document.getElementById("summary");

let suspiciousTransactions = [];

function formatMoney(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(Number(value || 0));
}

function renderSummary(state) {
  if (!state.latestRun) {
    summaryEl.textContent = state.runInProgress ? "Run in progress..." : "No run yet.";
    return;
  }

  const s = state.latestRun;
  summaryEl.textContent = `Transactions: ${s.totalTransactions} | Batches: ${s.chunks} | Suspicious: ${s.suspiciousTotal}`;
}

function renderSuspiciousRows() {
  suspiciousBody.innerHTML = "";

  for (const item of suspiciousTransactions) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${item.id}</td>
      <td>${item.accountId}</td>
      <td>${formatMoney(item.amount)}</td>
      <td>${item.riskScore}</td>
      <td>${item.reason}</td>
      <td>${item.batchId}</td>
    `;
    suspiciousBody.appendChild(tr);
  }
}

function pushEvent(event) {
  const row = document.createElement("div");
  row.className = "eventRow";
  row.textContent = `${event.ts} | ${event.type} | ${JSON.stringify(event.payload)}`;
  eventsEl.prepend(row);

  const rows = eventsEl.querySelectorAll(".eventRow");
  if (rows.length > 120) {
    rows[rows.length - 1].remove();
  }
}

async function fetchState() {
  const response = await fetch("/api/state");
  const state = await response.json();
  suspiciousTransactions = state.suspiciousTransactions || [];
  renderSuspiciousRows();
  renderSummary(state);
}

async function runDetection() {
  runBtn.disabled = true;
  try {
    await fetch("/api/run", { method: "POST" });
  } finally {
    runBtn.disabled = false;
  }
}

async function resetState() {
  await fetch("/api/reset", { method: "POST" });
  await fetchState();
}

runBtn.addEventListener("click", runDetection);
resetBtn.addEventListener("click", resetState);

const wsProtocol = location.protocol === "https:" ? "wss" : "ws";
const ws = new WebSocket(`${wsProtocol}://${location.host}`);

ws.addEventListener("message", async (message) => {
  const event = JSON.parse(message.data);
  pushEvent(event);

  if (event.type === "suspicious-detected" || event.type === "tool-call" || event.type === "run-status") {
    await fetchState();
  }
});

fetchState();
