const PROGRAM_ALIASES = [
  { program: "MDCAT", patterns: [/mdcat/i] },
  { program: "CSS", patterns: [/\bcss\b/i, /\bpms\b/i] },
  { program: "CA", patterns: [/\bca\b/i, /\bacca\b/i] },
  { program: "FSC", patterns: [/\bfsc\b/i] },
  { program: "MATRIC", patterns: [/matric/i, /9th class/i] },
  { program: "ECAT", patterns: [/\becat\b/i] },
  { program: "ISSB", patterns: [/\bissb\b/i] },
  { program: "AFNS", patterns: [/\bafns\b/i] }
];

const ISSUE_ALIASES = [
  { issue: "Access", patterns: [/course access/i, /\baccess\b/i] },
  { issue: "Login", patterns: [/login/i] },
  { issue: "Technical", patterns: [/technical/i] },
  { issue: "Payment", patterns: [/payment/i] },
  { issue: "Refund", patterns: [/refund/i] }
];

function deriveTagInsights(tags = [], customAttributes = {}) {
  const cleanTags = normalizeTags(tags);
  const haystack = [...cleanTags, ...Object.values(customAttributes).filter((value) => typeof value === "string")].join(" | ");
  const counselor = prefixedValue(cleanTags, "Counselor");
  const admissionsOwner = prefixedValue(cleanTags, "AD");
  const accessOwner = prefixedValue(cleanTags, "ACC");
  const supportOwner = prefixedValue(cleanTags, "CSA");
  const auditOwner = prefixedValue(cleanTags, "Audit") || prefixedValue(cleanTags, "AU");
  const stage = prefixedValue(cleanTags, "Stage");
  const marketingProgram = prefixedValue(cleanTags, "MKT");
  const program = detectProgram([marketingProgram, stage, haystack].filter(Boolean).join(" | "));
  const issueCategory = detectIssue(haystack);
  const owner = firstOwner([
    ["Counselor", counselor],
    ["Admissions", admissionsOwner],
    ["Access", accessOwner],
    ["Support", supportOwner],
    ["Audit", auditOwner]
  ]);

  return {
    program,
    counselor,
    stage,
    issueCategory,
    ownerRole: owner.role,
    ownerName: owner.name,
    normalizedTags: cleanTags
  };
}

function normalizeTags(tags) {
  return tags
    .map((tag) => String(tag || "").replace(/_/g, " ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function prefixedValue(tags, prefix) {
  const match = tags.find((tag) => tag.toLowerCase().startsWith(`${prefix.toLowerCase()}:`));
  if (!match) return null;
  return match.slice(match.indexOf(":") + 1).trim();
}

function detectProgram(value) {
  for (const item of PROGRAM_ALIASES) {
    if (item.patterns.some((pattern) => pattern.test(value))) return item.program;
  }
  return null;
}

function detectIssue(value) {
  for (const item of ISSUE_ALIASES) {
    if (item.patterns.some((pattern) => pattern.test(value))) return item.issue;
  }
  return null;
}

function firstOwner(options) {
  const found = options.find(([, name]) => Boolean(name));
  return found ? { role: found[0], name: found[1] } : { role: null, name: null };
}

module.exports = {
  deriveTagInsights
};
