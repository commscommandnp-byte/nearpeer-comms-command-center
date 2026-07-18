const state = {
  refreshMs: 1000
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
  return minutes(Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60000)));
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
  $("metricUnassignedMirror").textContent = totals.unassigned;
  $("metricOldestUnassigned").textContent = minutes(totals.oldestUnassignedMinutes);
  $("metricAdminHeld").textContent = totals.adminHeld;
  $("metricDelayed").textContent = totals.delayedReplies;
  $("metricDelayedMirror").textContent = totals.delayedReplies;
  $("metricExpiring").textContent = totals.aboutToExpire;
  $("metricCriticalExpiry").textContent = totals.criticalExpiry;
  $("metricOpen").textContent = totals.open;
  $("metricOldestAssigned").textContent = minutes(totals.oldestAssignedMinutes);
  $("metricLastAssigned").textContent = timeAgo(totals.lastAssignedAt);
  $("metricAgents").textContent = agents.filter((item) => item.name !== "Unassigned").length;
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
  $("opsDataBadge").textContent = operations.activeCounselorsConfigured ? "Active counselors set" : "Active list pending";
  $("adminAssignedToMe").textContent = admin.assignedToMe ?? 0;
  $("adminUnassigned").textContent = admin.unassigned ?? 0;
  $("adminPending").textContent = admin.pendingDispatch ?? 0;
  $("adminExpiringCount").textContent = admin.activeExpiring ?? 0;
  $("adminExpiredToday").textContent = admin.expiredToday ?? 0;
  $("adminExpiryRows").innerHTML = renderExpiryRows(admin.aboutToExpireRows || []);

  $("accessWaiting").textContent = access.waiting ?? 0;
  $("accessAssigned").textContent = access.assignedToMe ?? 0;
  $("accessCatered").textContent = access.catered ?? 0;
  $("accessLastAssigned").textContent = timeAgo(access.lastAssignedAt);
  $("accessLeadWindow").innerHTML = renderLeadWindow(access.lastAssignedLead, access.firstAssignedLead);
  $("accessIssueRows").innerHTML = (access.issueBreakdown || [])
    .slice(0, 5)
    .map((item) => `<span>${escapeHtml(item.name)} <b>${item.count}</b></span>`)
    .join("") || `<span>General <b>${access.assignedToMe || 0}</b></span>`;

  $("programLaneRows").innerHTML = (operations.programs || []).map(renderProgramLane).join("");
}

function renderProgramLane(lane) {
  const coverageText = lane.activeCounselorsKnown
    ? `${lane.activeCounselorAssigned} active | ${lane.inactiveCounselorAssigned} inactive`
    : "active counselor list pending";
  return `
    <article class="program-lane-card">
      <div class="ops-card-head">
        <div>
          <span>${escapeHtml(lane.name)}</span>
          <strong>${lane.assignedToMe}</strong>
        </div>
        <small>Assigned to me chats</small>
      </div>
      <div class="ops-stats">
        <div><b>${lane.waiting}</b><span>waiting</span></div>
        <div><b>${lane.catered}</b><span>replied/catered</span></div>
        <div><b>${timeAgo(lane.lastAssignedAt)}</b><span>last lead</span></div>
        <div><b>${timeAgo(lane.firstAssignedAt)}</b><span>first lead</span></div>
      </div>
      ${renderLeadWindow(lane.lastAssignedLead, lane.firstAssignedLead)}
      <p class="coverage-line">${escapeHtml(coverageText)}</p>
      <div class="counselor-list">${renderCounselorRows(lane.counselorBreakdown || [])}</div>
    </article>
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
  if (!rows.length) return `<div class="lane-empty">No counselor leads synced.</div>`;
  return rows
    .map((row) => {
      const activeLabel = row.active === null ? "" : row.active ? "active" : "inactive";
      return `
        <div class="counselor-row">
          <div><strong>${escapeHtml(row.name)}</strong><span>${row.waiting} waiting ${activeLabel ? `| ${activeLabel}` : ""}</span></div>
          <b>${row.count}</b>
        </div>
      `;
    })
    .join("");
}

function renderExpiryRows(rows) {
  if (!rows.length) return `<div class="lane-empty">No active chats inside the 120 minute expiry window.</div>`;
  return rows
    .map(
      (row) => `
        <div class="lane-mini-row expiry-row">
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

load();
