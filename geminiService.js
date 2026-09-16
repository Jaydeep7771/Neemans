/**
 * geminiService.js -- prompt construction + Google Gemini call.
 *
 * The model never decides *whether* something is broken; server.js already did that
 * deterministically. Gemini's job is interpretation: categorise messy event names,
 * translate network facts into business risk, and assign severity.
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const SEVERITIES = new Set(['High', 'Medium', 'Low']);

const SYSTEM_INSTRUCTION = `You are a Senior Business Analyst on a performance-marketing team.
You are reviewing the raw network telemetry captured from a real headless browser session on a
landing page that is about to receive paid ad traffic.

Your audience is a non-technical marketing stakeholder who controls the ad budget. They do not
know what an XHR is. They care about: wasted spend, mis-measured ROAS, broken optimisation
signals, and audience/retargeting gaps.

Rules:
- Work ONLY from the telemetry provided. Never invent events, vendors, IDs or HTTP statuses.
- Every issue must translate a technical fact into a concrete money/measurement consequence.
- Severity: High = spend will be actively misallocated or a conversion signal is missing entirely.
  Medium = reporting will be distorted or optimisation degraded. Low = hygiene / future risk.
- Do not repeat an issue that is already in deterministic_issues unless you are adding a
  materially different business consequence; prefer adding NEW issues the deterministic layer
  could not reason about (naming chaos, taxonomy drift, signal-quality gaps, consent risk).
- Be specific and quantitative where the data allows ("3 of 5 AddToCart hits", "2 pixel IDs").`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    executive_summary: { type: 'string' },
    event_taxonomy: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          observed_name: { type: 'string' },
          vendor: { type: 'string' },
          category: {
            type: 'string',
            enum: ['standard', 'custom_clear', 'custom_ambiguous', 'malformed', 'internal_debug'],
          },
          business_meaning: { type: 'string' },
          suggested_name: { type: 'string' },
          notes: { type: 'string' },
        },
        required: ['observed_name', 'vendor', 'category', 'business_meaning', 'suggested_name'],
      },
    },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          severity: { type: 'string', enum: ['High', 'Medium', 'Low'] },
          category: {
            type: 'string',
            enum: [
              'duplicate_events',
              'missing_tracking',
              'broken_request',
              'naming_taxonomy',
              'data_quality',
              'consent_privacy',
              'configuration',
            ],
          },
          business_risk: { type: 'string' },
          technical_evidence: { type: 'string' },
          recommended_fix: { type: 'string' },
          affected_metric: { type: 'string' },
        },
        required: ['title', 'severity', 'category', 'business_risk', 'technical_evidence', 'recommended_fix'],
      },
    },
    recommended_next_steps: { type: 'array', items: { type: 'string' } },
  },
  required: ['headline', 'executive_summary', 'event_taxonomy', 'issues', 'recommended_next_steps'],
};

function buildPrompt(findings) {
  return `Audit target: ${findings.targetUrl}

## Page load result
${JSON.stringify(findings.navigation, null, 2)}

## Deterministic counters
${JSON.stringify(findings.summary, null, 2)}

## Tag / vendor inventory observed on the wire
${JSON.stringify(findings.vendorInventory, null, 2)}

## Chronological event log (phase = what the browser was doing when the beacon fired)
${JSON.stringify(findings.eventLog, null, 2)}

## Duplicate payload groups (identical fingerprint fired more than once)
${JSON.stringify(findings.duplicates, null, 2)}

## Tracking requests that errored (4xx/5xx or transport failure)
${JSON.stringify(findings.failedRequests, null, 2)}

## Event names that are outside the platform's standard vocabulary
${JSON.stringify(findings.customEvents, null, 2)}

## Issues the deterministic layer already flagged
${JSON.stringify(
  findings.deterministicIssues.map((i) => ({ type: i.type, severity: i.severity, title: i.title })),
  null,
  2
)}

Produce the JSON report.
- event_taxonomy: one row per distinct event name in the log. Categorise it, say in plain
  English what a marketer should understand it to mean, and give the name it *should* have
  under the vendor's standard schema (or keep the name if it is already correct).
- issues: business-level issues with severity and a concrete fix.
- recommended_next_steps: 3-5 ordered actions, most urgent first.`;
}

/** Deterministic fallback so the product still ships a readable report with no API key. */
function fallbackAnalysis(findings, error) {
  const bySeverity = { High: 0, Medium: 0, Low: 0 };
  findings.deterministicIssues.forEach((i) => {
    bySeverity[i.severity] = (bySeverity[i.severity] || 0) + 1;
  });

  const eventTaxonomy = [
    ...new Set(findings.eventLog.map((e) => `${e.vendor}|${e.event}|${e.isStandardEvent}`)),
  ].map((key) => {
    const [vendor, observedName, standard] = key.split('|');
    return {
      observedName,
      vendor,
      category: standard === 'true' ? 'standard' : 'custom_ambiguous',
      businessMeaning:
        standard === 'true'
          ? 'Standard platform event -- recognised by the ad platform for optimisation.'
          : 'Non-standard name -- the ad platform cannot use it for automatic optimisation.',
      suggestedName: observedName,
      notes: 'Generated without Gemini (no API key configured).',
    };
  });

  return {
    available: false,
    error,
    headline: `${bySeverity.High || 0} high-severity tracking issue(s) found before launch`,
    executiveSummary:
      `Automated checks captured ${findings.summary.totalTrackingRequests} tracking requests from ` +
      `${findings.summary.vendorsDetected} vendor(s) and flagged ${findings.deterministicIssues.length} issue(s). ` +
      'AI commentary is unavailable, so only the deterministic findings are shown.',
    eventTaxonomy,
    issues: [],
    recommendedNextSteps: [
      'Set GEMINI_API_KEY to enable plain-English business-risk analysis.',
      'Resolve every High severity deterministic issue before enabling spend.',
    ],
  };
}

function normaliseIssues(raw) {
  return (raw || [])
    .filter((i) => i && i.title)
    .map((i, idx) => ({
      id: `ai-${idx + 1}`,
      source: 'gemini',
      type: i.category || 'data_quality',
      severity: SEVERITIES.has(i.severity) ? i.severity : 'Medium',
      title: i.title,
      detail: i.technical_evidence || '',
      businessRisk: i.business_risk || '',
      recommendedFix: i.recommended_fix || '',
      affectedMetric: i.affected_metric || '',
      evidence: [],
    }));
}

function normaliseTaxonomy(raw) {
  return (raw || [])
    .filter((t) => t && t.observed_name)
    .map((t) => ({
      observedName: t.observed_name,
      vendor: t.vendor || 'unknown',
      category: t.category || 'custom_ambiguous',
      businessMeaning: t.business_meaning || '',
      suggestedName: t.suggested_name || t.observed_name,
      notes: t.notes || '',
    }));
}

function parseModelJson(text) {
  const cleaned = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  return JSON.parse(cleaned);
}

const RETRYABLE = /\[(429|500|502|503|504)\s/;
const MAX_ATTEMPTS = 4;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Capacity blips (503) and rate limits (429) are common and temporary -- back off and retry. */
async function generateWithRetry(model, prompt) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await model.generateContent(prompt);
    } catch (err) {
      lastError = err;
      if (!RETRYABLE.test(err.message) || attempt === MAX_ATTEMPTS) throw err;
      const delay = 1000 * 2 ** (attempt - 1) + Math.floor(Math.random() * 400);
      console.warn(
        `[gemini] attempt ${attempt}/${MAX_ATTEMPTS} failed (retrying in ${delay}ms): ${err.message.slice(0, 120)}`
      );
      await sleep(delay);
    }
  }
  throw lastError;
}

async function analyseAuditFindings(findings) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return fallbackAnalysis(findings, 'GEMINI_API_KEY is not set.');

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: MODEL,
      systemInstruction: SYSTEM_INSTRUCTION,
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
      },
    });

    const result = await generateWithRetry(model, buildPrompt(findings));
    const parsed = parseModelJson(result.response.text());

    return {
      available: true,
      error: null,
      headline: parsed.headline || 'Pre-flight tracking audit complete',
      executiveSummary: parsed.executive_summary || '',
      eventTaxonomy: normaliseTaxonomy(parsed.event_taxonomy),
      issues: normaliseIssues(parsed.issues),
      recommendedNextSteps: parsed.recommended_next_steps || [],
    };
  } catch (err) {
    console.error('[gemini] analysis failed:', err.message);
    return fallbackAnalysis(findings, `Gemini call failed: ${err.message}`);
  }
}

module.exports = { analyseAuditFindings, buildPrompt, SYSTEM_INSTRUCTION, RESPONSE_SCHEMA };
