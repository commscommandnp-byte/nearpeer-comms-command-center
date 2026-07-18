const state = {
  refreshMs: 1000,
  selectedAccountKey: "admin",
  accounts: []
};

const $ = (id) => document.getElementById(id);

function minutes(value) {
  if (value === null || value === undefined) return "-";
  if (value < 60) return `${value}m`;
  const hours = Math.floor(value / 60);
  const mins = value % 60;
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

function timeAgo(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const diff = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));
  if (diff > 7 * 24 * 60) return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return minutes(diff);
}

function riskClass(risk) {
  if (risk === "critical") return "risk critical";
  if (risk === "warning") return "risk warning";
  return "risk";
}

async function load() {
  try {
    const response = await fetch("/api/wati/summary", { cache: "no-store" });
    const data = await response.json();
    render(data);
  } catch (error) {
    $("syncStatus").textContent = "Connection issue";
  } finally {
    setTimeout(load, state.refreshMs);
  }
}

function render(data) {
  if (!data || !data.summary || !data.summary.totals) {
    $("syncStatus").textContent = "No summary data";
    return;
  }

  const summary = data.summary;
  const totals = summary.totals;
  const teams = summary.teams || [];
  const agents = summary.agents || [];
  const programs = summary.programs || [];
  const actions = summary.actionRequired || [];
  const operations = data.operations || {};
  const pressure = totals.open ? Math.min(100, Math.round(((totals.delayedReplies + totals.unassigned + totals.criticalExpiry) / Math.max(1, totals.open * 2)) * 100)) : 0;

  $("syncStatus").textContent = `Updated ${new Date(summary.generatedAt).toLocaleTimeString()}`;
  $("modeBadge").textContent = modeLabel(data.mode);
  $("opsHeadline").textContent = headline(totals);
  $("opsBrief").textContent = brief(totals);
  $("metricUnassigned").textContent = totals.unassigned;
  $("metricDelayed").textContent = totals.delayedReplies;
  $("metricCriticalExpiry").textContent = totals.criticalExpiry;
  $("metricOpen").textContent = totals.open;
  $("summaryTotalActive").textContent = totals.open;
  $("actionCount").textContent = `${actions.length} ${actions.length === 1 ? "item" : "items"}`;
  $("holoCore").textContent = totals.open;
  renderHologram(totals);
  renderOperations(operations);
  $("pressureFill").style.width = `${pressure}%`;
  $("pressureCopy").textContent = `${pressure}% pressure from delayed, unassigned, and critical expiry signals.`;

  $("signalRows").innerHTML = renderSignals(totals);
  $("actionRows").innerHTML = actions.length
    ? actions
    .map(
      (item) => `
        <tr>
          <td><strong>${escapeHtml(item.studentName)}</strong><small>${escapeHtml(item.phone || "")}</small></td>
          <td>${escapeHtml(item.program)}</td>
          <td>${escapeHtml(item.team)}</td>
          <td>${escapeHtml(item.assignedTo || "Unassigned")}</td>
          <td>${escapeHtml(item.counselor || "-")}</td>
          <td>${minutes(item.waitingMinutes)}</td>
          <td>${minutes(item.expiryRemainingMinutes)}</td>
          <td><span class="${riskClass(item.risk)}">${item.risk}</span></td>
        </tr>
      `
    )
    .join("")
    : `<tr><td colspan="8" class="empty">No immediate action required.</td></tr>`;

  $("teamRows").innerHTML = teams.map(renderCompactRow).join("");
  $("agentRows").innerHTML = agents.map(renderCompactRow).join("");
  $("programRows").innerHTML = programs.map(renderProgramCard).join("");
}

function renderOperations(operations) {
  const admin = operations.admin || {};
  const access = operations.access || {};
  const accountRows = compactAccounts([
    { ...(admin || {}), key: "admin", type: "admin", name: "Admin Account" },
    ...(operations.programs || []),
    { ...(access || {}), key: "access", type: "access" }
  ]);
  state.accounts = accountRows;
  if (!accountRows.some((item) => item.key === state.selectedAccountKey)) state.selectedAccountKey = accountRows[0]?.key || "admin";

  $("summaryAdminUnassigned").textContent = admin.unassigned ?? 0;
  $("summaryAssignedPending").textContent = accountRows.reduce((total, item) => total + (item.waiting || item.pendingDispatch || 0), 0);
  $("summaryExpiringSoon").textContent = accountRows.reduce((total, item) => total + (item.expiring || item.activeExpiring || 0), 0);
  $("summaryExpiredToday").textContent = admin.expiredToday ?? 0;
  $("opsDataBadge").textContent = dataQualityLabel(operations);

  $("accountRows").innerHTML = accountRows.map(renderAccountLane).join("");
  renderDrilldown(accountRows.find((item) => item.key === state.selectedAccountKey) || accountRows[0]);
}

function renderAccountLane(lane) {
  const isSelected = lane.key === state.selectedAccountKey;
  const coverageText = lane.activeCounselorsKnown
    ? `${lane.activeCounselorAssigned} active | ${lane.inactiveCounselorAssigned} inactive`
    : lane.type === "access" ? "issue distribution" : lane.type === "admin" ? "reverse expiry timing" : "active counselor list pending";
  const distribution = lane.type === "access"
    ? renderIssueRows(lane.issueBreakdown || [], lane.assignedToMe || 0)
    : lane.type === "admin"
      ? renderExpiryRows(lane.aboutToExpireRows || [])
    : renderCounselorRows(lane.counselorBreakdown || []);
  return `
    <button class="account-row ${lane.type === "access" ? "access-row" : ""} ${lane.type === "admin" ? "admin-row" : ""} ${isSelected ? "selected" : ""}" data-account-key="${escapeHtml(lane.key)}" type="button">
      <div class="account-title">
        <span>${escapeHtml(lane.name)}</span>
        <strong>${lane.assignedToMe || 0}</strong>
        <small>Assigned to me</small>
      </div>
      <div class="account-metrics">
        <div><b>${lane.type === "admin" ? lane.unassigned || 0 : lane.waiting || 0}</b><span>${lane.type === "admin" ? "Unassigned" : "Waiting"}</span></div>
        <div><b>${lane.catered || 0}</b><span>Catered</span></div>
        <div><b>${timeAgo(lane.lastAssignedAt)}</b><span>Last lead</span></div>
        <div><b>${timeAgo(lane.firstAssignedAt)}</b><span>Oldest lead</span></div>
        <div><b>${lane.expiring || lane.activeExpiring || 0}</b><span>Expiring</span></div>
        <div><b>${lane.missingCounselorTags || 0}</b><span>Missing tags</span></div>
      </div>
      <div class="account-detail">
        <span>${escapeHtml(coverageText)}</span>
        ${renderLeadWindow(lane.lastAssignedLead, lane.firstAssignedLead)}
      </div>
      <div class="account-distribution">${distribution}</div>
    </button>
  `;
}

function compactAccounts(accounts) {
  return accounts.map((item) => ({
    assignedToMe: 0,
    waiting: 0,
    catered: 0,
    expiring: 0,
    missingCounselorTags: 0,
    allRows: [],
    riskRows: [],
    missingTagRows: [],
    aboutToExpireRows: [],
    ...item
  }));
}

function dataQualityLabel(operations) {
  const quality = operations.dataQuality;
  if (!quality || !quality.total) return "Data quality pending";
  const suffix = operations.activeCounselorsConfigured ? "active list set" : "active list pending";
  return `Data quality ${quality.score}% | ${suffix}`;
}

function renderDrilldown(account) {
  if (!account) return;
  $("drilldownTitle").textContent = account.name;
  $("drilldownBadge").textContent = `${account.assignedToMe || 0} assigned`;
  $("drillDistribution").innerHTML = account.type === "access"
    ? renderIssueRows(account.issueBreakdown || [], account.assignedToMe || 0)
    : account.type === "admin"
      ? renderAdminDistribution(account)
      : renderCounselorRows(account.counselorBreakdown || []);
  $("drillExpiry").innerHTML = renderExpiryRows(account.aboutToExpireRows || []);
  $("drillRiskRows").innerHTML = renderDrillRows(account.riskRows || [], "No risk rows for this account.");
  $("drillMissingTags").innerHTML = renderDrillRows(account.missingTagRows || [], "No missing counselor tags in synced rows.");
  $("drillChatRows").innerHTML = renderDrillRows(account.allRows || [], "No synced chats for this account.");
}

function renderAdminDistribution(account) {
  return `
    <div class="counselor-row"><div><strong>Unassigned chats</strong><span>need dispatch</span></div><b>${account.unassigned || 0}</b></div>
    <div class="counselor-row"><div><strong>Waiting reply</strong><span>student replied last</span></div><b>${account.pendingDispatch || 0}</b></div>
    <div class="counselor-row"><div><strong>Expired today</strong><span>24h window ended</span></div><b>${account.expiredToday || 0}</b></div>
  `;
}

function renderDrillRows(rows, emptyText) {
  if (!rows.length) return `<div class="lane-empty">${escapeHtml(emptyText)}</div>`;
  return `
    <table class="mini-table">
      <thead><tr><th>Chat</th><th>Program</th><th>Counselor</th><th>Waiting</th><th>Expiry</th></tr></thead>
      <tbody>
        ${rows.map((row) => `
          <tr>
            <td><strong>${escapeHtml(row.studentName)}</strong><small>${escapeHtml(row.phone || "")}</small></td>
            <td>${escapeHtml(row.program || "-")}</td>
            <td>${escapeHtml(row.missingCounselorTag ? "Tag missing" : row.counselor || "-")}</td>
            <td>${minutes(row.waitingMinutes)}</td>
            <td>${minutes(row.expiryRemainingMinutes)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

function renderLeadWindow(lastLead, firstLead) {
  return `
    <div class="lead-window">
      ${renderLeadPoint("Last assigned chat", lastLead)}
      ${renderLeadPoint("Oldest assigned chat", firstLead)}
    </div>
  `;
}

function renderLeadPoint(label, lead) {
  if (!lead) {
    return `<div><span>${escapeHtml(label)}</span><strong>-</strong><small>No synced lead.</small></div>`;
  }
  return `
    <div>
      <span>${escapeHtml(label)}</span>
      <strong>${timeAgo(lead.assignedAt)}</strong>
      <small>${escapeHtml(lead.studentName)} ${lead.phone ? `| ${escapeHtml(lead.phone)}` : ""}</small>
    </div>
  `;
}

function renderCounselorRows(rows) {
  if (!rows.length) return `<div class="lane-empty">Counselor tags not synced.</div>`;
  return rows
    .map((row) => {
      const activeLabel = row.active === null ? "" : row.active ? "active" : "inactive";
      const name = row.name === "No counselor" ? "Counselor tag missing" : row.name;
      return `
        <div class="counselor-row">
          <div><strong>${escapeHtml(name)}</strong><span>${row.waiting} waiting ${activeLabel ? `| ${activeLabel}` : ""}</span></div>
          <b>${row.count}</b>
        </div>
      `;
    })
    .join("");
}

function renderIssueRows(rows, fallbackCount) {
  const cleanRows = rows.length ? rows : [{ name: "General", count: fallbackCount || 0 }];
  return cleanRows
    .slice(0, 5)
    .map(
      (row) => `
        <div class="counselor-row issue-row">
          <div><strong>${escapeHtml(row.name)}</strong><span>issue bucket</span></div>
          <b>${row.count}</b>
        </div>
      `
    )
    .join("");
}

function renderExpiryRows(rows) {
  if (!rows.length) return `<div class="lane-empty compact-empty">No active chats inside 120 minute expiry window.</div>`;
  return rows
    .map(
      (row) => `
        <div class="expiry-chip">
          <div><strong>${escapeHtml(row.studentName)}</strong><span>${escapeHtml(row.phone || "")}</span></div>
          <div><b>${minutes(row.expiryRemainingMinutes)}</b><span>remaining</span></div>
        </div>
      `
    )
    .join("");
}

function renderLaneMiniRows(rows) {
  if (!rows.length) return `<div class="lane-empty">No waiting leads.</div>`;
  return rows
    .map(
      (row) => `
        <div class="lane-mini-row">
          <div><strong>${escapeHtml(row.studentName)}</strong><span>${escapeHtml(row.phone || "")}</span></div>
          <div><b>${minutes(row.waitingMinutes)}</b><span>${escapeHtml(row.counselor || row.owner || "-")}</span></div>
        </div>
      `
    )
    .join("");
}

function modeLabel(mode) {
  if (mode === "supabase-sync") return "Supabase sync";
  if (mode === "supabase-empty") return "Supabase ready";
  if (mode === "sync-required") return "Sync required";
  if (mode === "setup-required") return "Setup required";
  return "Live WATI";
}

function headline(totals) {
  if (totals.unassigned > 0) return `${totals.unassigned} ${plural(totals.unassigned, "chat needs", "chats need")} assignment`;
  if (totals.criticalExpiry > 0) return `${totals.criticalExpiry} ${plural(totals.criticalExpiry, "session", "sessions")} critical`;
  if (totals.delayedReplies > 0) return `${totals.delayedReplies} ${plural(totals.delayedReplies, "reply", "replies")} delayed`;
  return "WATI queue is under control";
}

function plural(value, one, many) {
  return value === 1 ? one : many;
}

function brief(totals) {
  const parts = [
    `${totals.open} open`,
    `${totals.adminHeld} admin-held`,
    `${totals.aboutToExpire} expiring soon`
  ];
  return parts.join(" | ");
}

function renderSignals(totals) {
  const signals = [
    { label: "Assign now", value: totals.unassigned, tone: totals.unassigned ? "critical" : "normal" },
    { label: "Move from Admin", value: totals.adminHeld, tone: totals.adminHeld ? "warning" : "normal" },
    { label: "Reply breach", value: totals.delayedReplies, tone: totals.delayedReplies ? "warning" : "normal" },
    { label: "Session critical", value: totals.criticalExpiry, tone: totals.criticalExpiry ? "critical" : "normal" }
  ];

  return signals
    .map(
      (item) => `
        <div class="signal ${item.tone}">
          <span>${escapeHtml(item.label)}</span>
          <strong>${item.value}</strong>
        </div>
      `
    )
    .join("");
}

function renderHologram(totals) {
  const maxValue = Math.max(1, totals.open, totals.unassigned, totals.delayedReplies, totals.aboutToExpire);
  const values = [totals.open, totals.unassigned, totals.delayedReplies, totals.aboutToExpire];
  document.querySelectorAll("#holoTowers i").forEach((tower, index) => {
    const height = 28 + Math.round((values[index] / maxValue) * 116);
    tower.style.setProperty("--tower-height", `${height}px`);
    tower.style.setProperty("--tower-value", `"${values[index]}"`);
  });
}

function renderCompactRow(item) {
  return `
    <div class="compact-row">
      <div>
        <strong>${escapeHtml(item.name)}</strong>
        <span>Open ${item.open} | Unassigned ${item.unassigned}</span>
      </div>
      <div>
        <b>${item.delayedReplies}</b>
        <span>delayed</span>
      </div>
      <div>
        <b>${minutes(item.oldestWaitingMinutes)}</b>
        <span>oldest</span>
      </div>
    </div>
  `;
}

function renderProgramCard(item) {
  return `
    <div class="program-card">
      <strong>${escapeHtml(item.name)}</strong>
      <span>${item.open} open</span>
      <small>${item.delayedReplies} delayed | oldest ${minutes(item.oldestWaitingMinutes)}</small>
    </div>
  `;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

document.addEventListener("click", (event) => {
  const accountRow = event.target.closest("[data-account-key]");
  if (!accountRow) return;
  state.selectedAccountKey = accountRow.dataset.accountKey;
  $("accountRows").innerHTML = state.accounts.map(renderAccountLane).join("");
  renderDrilldown(state.accounts.find((item) => item.key === state.selectedAccountKey));
  $("drilldown").scrollIntoView({ behavior: "smooth", block: "start" });
});

load();
