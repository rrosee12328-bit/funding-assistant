// ============================================================================
// EXTRACTION HELPERS
//
// AI populates the raw structured data (names, numbers, dates, balances) —
// but strict, deterministic validation decides whether an extracted row is
// allowed into the account table. Never let the AI's own confidence claims
// decide; recompute confidence here.
// ============================================================================

import { randomUUID } from "crypto";
import {
  type CreditAccount,
  type Bureau,
  accountTypeEnum,
  bureauEnum,
} from "@shared/schema";

export const BUREAU_HEADERS = /^(transunion|experian|equifax|tu|ex|eq)$/i;
export const GENERIC_LABELS = /^(collection account|account name|account number|acct(?:ount)?\s*(?:#|no\.?|number)?|status|type|date|balance|payment|remarks|comments|account type|responsibility|condition|pay status|account status|creditor|creditor name|company|company name|collector|collector name|collection agency|original creditor|credit limit|high balance|terms|date opened|date reported|date of status|last reported)$/i;
export const GENERIC_WORDS = /^(collection|account|status|type|date|the|and|for|with|from|this|that|not|are|was|were|has|have|had|been|will|would|could|should|may|might|shall|can|did|does|do|is|am|be)$/i;
export const PLACEHOLDER_NAMES = /^(unknown|unknown collection|n\/a|na|not available|not provided|not listed|none)$/i;

export const JUNK_PHRASES = [
  /reported\s+(yes|no)/i,
  /classification/i,
  /^account status$/i,
  /^payment status$/i,
  /^\d+\.\s+(?:public records?|collections?|inquiries?|consumer statements?)(?:\s+\d+)?$/i,
  /^charge\s*off(?:\s+(?:0|n\/a|na|yes|no|unknown))*$/i,
  /^public records?(?:\s+\d+|\s+0|\s+n\/a|\s+na)*$/i,
  /^(?:equifax|experian|transunion)(?:\s+(?:equifax|experian|transunion))*$/i,
  /\bsummary\b/i,
  /\bbalances?\b.*\b(too high|utilization)\b/i,
  /creditor classification/i,
  /payment history/i,
  /debt[- ]to[- ]credit/i,
  /^credit score/i,
  /^credit limit$/i,
  /\btip[s]?\b/i,
  /page \d+ of \d+/i,
  /powered by/i,
  /three bureau/i,
  /^credit report$/i,
  /consumer statement/i,
  /personal note/i,
  /\byour\b.*\b(score|credit|ratio|history)\b/i,
  /\bthe\b.*\b(table|section|chart|idea)\b/i,
];

export function normalizeNameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function isPlaceholderName(name: string): boolean {
  return PLACEHOLDER_NAMES.test(name.trim());
}

export function sanitizeCompanyCandidate(candidate: string): string {
  return candidate
    .replace(/^(?:account|creditor|company|collector|collection agency|original creditor)\s*(?:name)?\s*[:#\-–|]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isJunkAccountName(name: string): boolean {
  const normalized = sanitizeCompanyCandidate(name || "");
  if (!normalized) return true;
  if (BUREAU_HEADERS.test(normalized)) return true;
  if (GENERIC_LABELS.test(normalized)) return true;
  if (isPlaceholderName(normalized)) return true;
  const words = normalized.split(/\s+/);
  if (words.length === 1 && GENERIC_WORDS.test(words[0])) return true;
  return JUNK_PHRASES.some(pattern => pattern.test(normalized));
}

export function maskAccountNumber(raw: string | null | undefined): string {
  if (!raw) return "";
  const cleaned = raw.replace(/\s+/g, "").replace(/^[#:]+|[#:]+$/g, "");
  const visible = cleaned.replace(/^[xX*#•-]+/, "");
  const valueToMask = visible || cleaned;
  const digits = valueToMask.replace(/\D/g, "");
  if (digits.length >= 4) return `****${digits.slice(-4)}`;
  const alnum = valueToMask.replace(/[^A-Za-z0-9]/g, "");
  if (alnum.length >= 4) return `****${alnum.slice(-4)}`;
  if (alnum.length >= 2 && /[xX*#•-]/.test(cleaned)) return `****${alnum}`;
  return valueToMask;
}

export function hasUsableAccountNumber(accountNumber: string | null | undefined): boolean {
  const raw = (accountNumber || "").trim();
  if (
    !raw ||
    /^n\/?a$/i.test(raw) ||
    /^\(?\d{3}\)?[-\s]?\d{3}[-\s]?\d{4}$/.test(raw) ||
    /^\d{4}[-/]\d{1,2}(?:[-/]\d{1,2})?$/.test(raw) ||
    /^\d{1,2}[-/]\d{4}$/.test(raw) ||
    /^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/.test(raw)
  ) {
    return false;
  }

  const normalized = maskAccountNumber(accountNumber || "");
  const visible = normalized.replace(/^[*#•xX-]+/, "").replace(/[^A-Za-z0-9]/g, "");
  return Boolean(
    normalized &&
    !/^n\/?a$/i.test(normalized) &&
    visible.length >= 2 &&
    /[A-Za-z0-9]/.test(visible) &&
    (visible.replace(/\D/g, "").length >= 2 || /[A-Za-z]/.test(visible))
  );
}

const KNOWN_COMPANY_PATTERN = /portfolio recovery|midland credit|lvnv funding|convergent|enhanced recovery|ic system|credence|radius global|national credit|allied interstate|progressive|credit corp|receivables|asset acceptance|cavalry|cach|first premier|jefferson capital|encore capital|unifin|transworld|credit collection|collection bureau|capital one|chase|discover|american express|amex|citi|wells fargo|bank of america|synchrony|barclays|us bank|navy federal|toyota|honda|ford|nissan|carmax|santander|ally financial|carvana|sofi|upstart|avant|credit acceptance|nelnet|navient|great lakes|sallie mae|mohela|rocket mortgage|quicken loans|penfed|regions bank|pnc bank|truist|kovo|self financial|credit strong|extraordinary credit|agency|associates|financial|services|solutions|capital|funding|recovery|management|bank|credit union/i;

export function scoreCompanyName(candidate: string): number {
  const trimmed = sanitizeCompanyCandidate(candidate || "");
  if (!trimmed || trimmed.length < 2) return -1;
  if (trimmed.length > 80) return -1;
  if (isJunkAccountName(trimmed)) return -1;
  if (/^\$[\d,.]+$/.test(trimmed)) return -1;
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(trimmed)) return -1;
  if (/^\d+$/.test(trimmed)) return -1;

  let score = 0;
  if (KNOWN_COMPANY_PATTERN.test(trimmed)) score += 30;
  const isUpperCase = trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed);
  if (isUpperCase) score += 10;
  if (/^[A-Z][a-z]/.test(trimmed)) score += 5;
  if (/[A-Za-z]/.test(trimmed)) score += 5;
  const words = trimmed.split(/\s+/);
  if (words.length >= 1 && words.length <= 6) score += 5;
  if (/\b(inc|llc|ltd|corp|co|lp|group)\b/i.test(trimmed)) score += 15;

  return score;
}

/**
 * Recompute a strict confidence score (0-100) for an extracted account,
 * ignoring whatever confidence the AI itself claimed. Accounts scoring below
 * the acceptance threshold get routed to the hidden review list instead of
 * the main account table.
 */
export function computeAccountConfidence(account: Partial<CreditAccount>): number {
  const name = sanitizeCompanyCandidate(account.creditorName || "");
  const acctNum = maskAccountNumber(account.accountNumberMasked || "");
  const hasAccountNumber = hasUsableAccountNumber(acctNum);
  const accountType = account.accountType;

  if (isJunkAccountName(name)) return 0;
  if (!accountType || !accountTypeEnum.options.includes(accountType as any)) return 0;

  let confidence = 0;

  if (name.length >= 2 && /[A-Za-z]/.test(name)) confidence += 35;
  if (hasAccountNumber) confidence += 25;
  confidence += 20; // has a recognized account type

  const hasFinancialData =
    typeof account.currentBalance === "number" ||
    typeof account.creditLimitOrOriginalAmount === "number" ||
    typeof account.monthlyPayment === "number" ||
    !!account.dateOpened;
  if (hasFinancialData) confidence += 20;

  const nameWords = name.split(/\s+/);
  if (nameWords.length > 8) confidence -= 30;
  const uniqueWords = new Set(nameWords.map(w => w.toLowerCase()));
  if (nameWords.length >= 3 && uniqueWords.size <= Math.ceil(nameWords.length / 2)) confidence -= 40;
  if (/[.!?]$/.test(name) && nameWords.length > 4) confidence -= 30;
  if (scoreCompanyName(name) < 0) confidence -= 20;

  return Math.max(0, Math.min(100, confidence));
}

export const ACCOUNT_ACCEPTANCE_THRESHOLD = 60;

/**
 * Normalize a raw AI-extracted account object into a well-formed CreditAccount,
 * filling in a stable id and safe defaults for anything missing.
 */
export function normalizeAccount(raw: any): CreditAccount {
  const accountTypeRaw = typeof raw?.accountType === "string" ? raw.accountType : "Other";
  const accountType = accountTypeEnum.options.includes(accountTypeRaw as any) ? accountTypeRaw : "Other";

  const bureaus: Bureau[] = Array.isArray(raw?.bureausReporting)
    ? raw.bureausReporting.filter((b: any) => bureauEnum.options.includes(b))
    : [];

  const toNumberOrNull = (v: any): number | null => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const cleaned = v.replace(/[$,]/g, "");
      const n = parseFloat(cleaned);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  };

  return {
    id: typeof raw?.id === "string" && raw.id ? raw.id : randomUUID(),
    creditorName: sanitizeCompanyCandidate(String(raw?.creditorName || raw?.accountName || "")),
    accountNumberMasked: maskAccountNumber(raw?.accountNumberMasked) || "N/A",
    accountType: accountType as any,
    accountStatus: String(raw?.accountStatus || "Unknown"),
    openClosed: raw?.openClosed === "Open" || raw?.openClosed === "Closed" ? raw.openClosed : "Unknown",
    dateOpened: raw?.dateOpened ? String(raw.dateOpened) : null,
    accountAgeMonths: toNumberOrNull(raw?.accountAgeMonths),
    currentBalance: toNumberOrNull(raw?.currentBalance),
    creditLimitOrOriginalAmount: toNumberOrNull(raw?.creditLimitOrOriginalAmount),
    monthlyPayment: toNumberOrNull(raw?.monthlyPayment),
    pastDueAmount: toNumberOrNull(raw?.pastDueAmount),
    paymentStatus: raw?.paymentStatus ? String(raw.paymentStatus) : null,
    latePaymentsLast24Months: typeof raw?.latePaymentsLast24Months === "number" ? raw.latePaymentsLast24Months : 0,
    lateHistoryNotes: raw?.lateHistoryNotes ? String(raw.lateHistoryNotes) : null,
    bureausReporting: bureaus,
    isDerogatory: Boolean(raw?.isDerogatory) || ["Collection", "Charge-Off", "Bankruptcy Public Record"].includes(accountType),
    includedInBankruptcy: Boolean(raw?.includedInBankruptcy),
    confidence: 0, // recomputed below
  };
}

/**
 * Compute account age in months from a date-opened string relative to the report date.
 * Falls back to whatever the extraction already provided if the date can't be parsed.
 */
export function computeAccountAgeMonths(dateOpened: string | null, reportDate: string, fallback: number | null): number | null {
  if (!dateOpened) return fallback;
  const opened = new Date(dateOpened);
  const asOf = new Date(reportDate);
  if (Number.isNaN(opened.getTime()) || Number.isNaN(asOf.getTime())) return fallback;
  const months = (asOf.getFullYear() - opened.getFullYear()) * 12 + (asOf.getMonth() - opened.getMonth());
  return months >= 0 ? months : fallback;
}

function cleanSectionAccountName(rawName: string): string {
  return rawName
    .replace(/\s+\d+$/, "")
    .replace(/\s*\(CLOSED\)\s*$/i, "")
    .replace(/[,\s]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function chooseBestAccountNumber(raw: string): string {
  const candidates: string[] = [];
  const accountPattern = /(?:[#*Xx•-]+\s*)+[A-Za-z0-9]{2,}|(?:[#*Xx•-]+\s*)?\d{4,}/g;
  let match: RegExpExecArray | null;

  while ((match = accountPattern.exec(raw)) !== null) {
    const candidate = maskAccountNumber(match[0]);
    if (hasUsableAccountNumber(candidate)) candidates.push(candidate);
  }

  if (candidates.length === 0) return "";

  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    counts.set(candidate, (counts.get(candidate) || 0) + 1);
  }

  return candidates.reduce((best, candidate) => {
    const bestCount = counts.get(best) || 0;
    const candidateCount = counts.get(candidate) || 0;
    return candidateCount > bestCount ? candidate : best;
  }, candidates[0]);
}

function extractAccountNumberFromText(rawBlock: string): string {
  const lines = rawBlock.split("\n").map(line => line.trim()).filter(Boolean);
  const labeledAccountPattern = /(?:account\s*(?:number|#|num|no\.?)|acct\s*(?:#|num|no\.?|number)?|case\s*(?:number|#))\s*[:#\-–]?\s*(.+)$/i;

  for (const line of lines) {
    if (/account\s+name/i.test(line)) continue;
    const labeledMatch = line.match(labeledAccountPattern);
    if (labeledMatch) {
      const masked = chooseBestAccountNumber(labeledMatch[1]);
      if (hasUsableAccountNumber(masked)) return masked;
    }
  }

  return chooseBestAccountNumber(rawBlock);
}

function parseMoney(value: string): number | null {
  const match = value.match(/\$?(-?[\d,]+(?:\.\d{1,2})?)/);
  if (!match) return null;
  const parsed = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function extractMoneyFromLine(blockText: string, labelPattern: RegExp): number | null {
  const line = blockText.split("\n").find(l => labelPattern.test(l));
  if (!line) return null;
  const values = line.replace(labelPattern, "").match(/\$[\d,]+(?:\.\d{1,2})?|(?:^|\s)(?:N\/A|NA|\d[\d,]*(?:\.\d{1,2})?)(?=\s|$)/gi) || [];
  const moneyValues = values
    .map(v => parseMoney(v))
    .filter((v): v is number => typeof v === "number");
  return moneyValues.find(v => v > 0) ?? moneyValues[0] ?? null;
}

function hasPositiveMoneyValue(values: string): boolean {
  const moneyMatches = values.match(/\$[\d,]+/g) || [];
  return moneyMatches.some(value => Number(value.replace(/[$,]/g, "")) > 0);
}

function inferDeterministicAccountType(sectionNumber: string, blockText: string): CreditAccount["accountType"] {
  const lines = blockText.split("\n");
  const chargeOffLine = lines.find(line => /^charge\s*off\s+amount\b/i.test(line));
  const statusLines = lines.filter(line => /^(?:account\s+status|status)\b/i.test(line) && !/^status\s+date\b/i.test(line));
  const loanTypeLine = lines.find(line => /^loan\s+type\b/i.test(line)) || "";

  if (
    (chargeOffLine && hasPositiveMoneyValue(chargeOffLine)) ||
    /\b(?:charged\s+off|charge[\s-]?off\s+account|account\s+charged\s+to\s+profit\s+and\s+loss|unpaid\s+balance\s+reported\s+as\s+a\s+loss)\b/i.test(blockText)
  ) {
    return "Charge-Off";
  }

  if (
    statusLines.some(line => /collection/i.test(line)) ||
    /\bcollection account\b/i.test(blockText) && /-\s*collection account\b/i.test(blockText)
  ) {
    return "Collection";
  }

  if (/mortgage|real\s+estate/i.test(loanTypeLine) || sectionNumber === "3") return "Mortgage";
  if (/auto|vehicle|lease/i.test(loanTypeLine)) return "Auto Loan";
  if (/student|education|dept\s+of\s+ed|aidvantage/i.test(`${loanTypeLine}\n${blockText}`)) return "Student Loan";
  if (/personal/i.test(loanTypeLine)) return "Personal Loan";
  if (/credit\s*builder|self|kikoff/i.test(`${loanTypeLine}\n${blockText}`)) return "Credit Builder";
  if (/charge\s+card/i.test(loanTypeLine)) return "Charge Card";
  if (/revolving|credit\s*card|bankcard/i.test(loanTypeLine) || sectionNumber === "2") return "Revolving Credit Card";
  if (sectionNumber === "4") return "Installment Loan";

  return "Other";
}

function inferOpenClosed(headerText: string, blockText: string): CreditAccount["openClosed"] {
  if (/\(closed\)|\bclosed\b/i.test(headerText)) return "Closed";
  const accountStatusLine = blockText.split("\n").find(line => /^account\s+status\b/i.test(line)) || "";
  if (/\bclosed\b/i.test(accountStatusLine)) return "Closed";
  if (/\bopen\b/i.test(accountStatusLine)) return "Open";
  return "Unknown";
}

function extractDateOpened(blockText: string): string | null {
  const line = blockText.split("\n").find(l => /^date\s+opened\b/i.test(l));
  if (!line) return null;
  const dateMatch =
    line.match(/\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b/i) ||
    line.match(/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/) ||
    line.match(/\b\d{4}-\d{1,2}-\d{1,2}\b/);
  return dateMatch ? dateMatch[0] : null;
}

function extractAccountStatus(blockText: string): string {
  const statusLine = blockText
    .split("\n")
    .find(line => /^(?:account\s+status|status)\b/i.test(line) && !/^status\s+date\b/i.test(line));
  if (!statusLine) return "Unknown";
  return statusLine.replace(/^(?:account\s+status|status)\s*/i, "").trim() || "Unknown";
}

function inferRecentLatePaymentCount(blockText: string): { count: number; notes: string | null } {
  const statusLines = blockText
    .split("\n")
    .filter(line => /^(?:account\s+status|status)\b/i.test(line) && !/^status\s+date\b/i.test(line));

  if (
    statusLines.some(line => /\b(?:late|past\s+due|delinquent)\b/i.test(line)) ||
    /\baccount\s+delinquent\b/i.test(blockText)
  ) {
    return { count: 1, notes: "Current account status/comment indicates late or past-due reporting." };
  }

  return { count: 0, notes: null };
}

function inferBureausReporting(blockText: string): Bureau[] {
  const firstLines = blockText.split("\n").slice(0, 8).join("\n");
  const bureaus: Bureau[] = [];
  if (/experian/i.test(firstLines) || /experian/i.test(blockText)) bureaus.push("Experian");
  if (/equifax/i.test(firstLines) || /equifax/i.test(blockText)) bureaus.push("Equifax");
  if (/transunion|trans\s*union/i.test(firstLines) || /transunion|trans\s*union/i.test(blockText)) bureaus.push("TransUnion");
  return bureaus.length > 0 ? bureaus : ["Experian"];
}

function buildDeterministicAccount(raw: {
  sectionNumber: string;
  accountName: string;
  headerText: string;
  blockText: string;
  reportDate: string;
}): CreditAccount | null {
  const accountName = cleanSectionAccountName(raw.accountName);
  if (isJunkAccountName(accountName) || scoreCompanyName(accountName) < 0) return null;

  const accountNumberMasked = extractAccountNumberFromText(raw.blockText);
  if (!hasUsableAccountNumber(accountNumberMasked)) return null;

  const accountType = inferDeterministicAccountType(raw.sectionNumber, raw.blockText);
  const dateOpened = extractDateOpened(raw.blockText);
  const latePayment = inferRecentLatePaymentCount(raw.blockText);
  const creditLimitOrOriginalAmount =
    extractMoneyFromLine(raw.blockText, /^credit\s+limit\b/i) ??
    extractMoneyFromLine(raw.blockText, /^(?:original\s+amount|high\s+credit|highest\s+balance)\b/i);

  const account: CreditAccount = {
    id: randomUUID(),
    creditorName: accountName,
    accountNumberMasked,
    accountType,
    accountStatus: extractAccountStatus(raw.blockText),
    openClosed: inferOpenClosed(raw.headerText, raw.blockText),
    dateOpened,
    accountAgeMonths: computeAccountAgeMonths(dateOpened, raw.reportDate, null),
    currentBalance: extractMoneyFromLine(raw.blockText, /^(?:reported\s+)?balance\b/i),
    creditLimitOrOriginalAmount,
    monthlyPayment: extractMoneyFromLine(raw.blockText, /^monthly\s+payment(?:\s+amount)?\b/i),
    pastDueAmount: extractMoneyFromLine(raw.blockText, /^amount\s+past\s+due\b/i),
    paymentStatus: extractAccountStatus(raw.blockText),
    latePaymentsLast24Months: latePayment.count,
    lateHistoryNotes: latePayment.notes,
    bureausReporting: inferBureausReporting(raw.blockText),
    isDerogatory: ["Collection", "Charge-Off", "Bankruptcy Public Record"].includes(accountType) || latePayment.count > 0,
    includedInBankruptcy: false,
    confidence: 100,
  };

  return account;
}

export function extractDeterministicAccountsFromText(text: string, reportDate: string): CreditAccount[] {
  const lines = text.split("\n").map(line => line.trim()).filter(Boolean);
  const accounts: CreditAccount[] = [];

  for (let i = 0; i < lines.length; i++) {
    const headerMatch = lines[i].match(/^([2345])\.\d+\s+(.+?)(?:\s+\d+)?$/);
    if (!headerMatch) continue;

    const blockLines: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (/^[2345]\.\d+\s+/.test(lines[j]) || /^(?:6|7|8|9|10|11|12)\.\s+/.test(lines[j])) break;
      blockLines.push(lines[j]);
    }

    const blockText = blockLines.join("\n");
    if (!/account\s+number/i.test(blockText)) continue;

    const account = buildDeterministicAccount({
      sectionNumber: headerMatch[1],
      accountName: headerMatch[2],
      headerText: lines[i],
      blockText,
      reportDate,
    });
    if (!account) continue;

    accounts.push(account);
  }

  const deduped: CreditAccount[] = [];
  for (const account of accounts) {
    const nameKey = normalizeNameKey(account.creditorName);
    const numberKey = maskAccountNumber(account.accountNumberMasked);
    const existing = deduped.find(candidate =>
      normalizeNameKey(candidate.creditorName) === nameKey &&
      maskAccountNumber(candidate.accountNumberMasked) === numberKey
    );

    if (!existing) {
      deduped.push(account);
      continue;
    }

    if (existing.accountType !== "Charge-Off" && account.accountType === "Charge-Off") {
      existing.accountType = account.accountType;
      existing.isDerogatory = true;
    }
    if (existing.latePaymentsLast24Months < account.latePaymentsLast24Months) {
      existing.latePaymentsLast24Months = account.latePaymentsLast24Months;
      existing.lateHistoryNotes = account.lateHistoryNotes;
    }
    const bureaus = new Set([...existing.bureausReporting, ...account.bureausReporting]);
    existing.bureausReporting = Array.from(bureaus);
  }

  return deduped;
}

export function extractActualPublicRecordCount(text: string): number | null {
  const summaryMatch = text.match(/\bPublic Records\s+(\d+)\s+(\d+)\s+(\d+)\b/i);
  if (summaryMatch) {
    return summaryMatch
      .slice(1)
      .reduce((total, value) => total + Number(value || 0), 0);
  }

  const publicRecordsSection = text.match(/10\.\s+Public Records([\s\S]*?)(?:11\.\s+Collections|12\.\s+|$)/i)?.[1] || "";
  if (!publicRecordsSection) return null;
  if (/currently have no bankruptcies/i.test(publicRecordsSection)) return 0;

  const courtRecordMatches = publicRecordsSection.match(
    /\b(?:chapter\s*(?:7|13)|bk(?:7|13)|u\.?s\.?\s*bankruptcy\s*court|court\s*record|tax\s*lien|civil\s*judgment|case\s*(?:number|#))/gi
  ) || [];

  return courtRecordMatches.length;
}

// ============================================================================
// PDF TEXT QUALITY — decides whether extracted PDF text is even plausibly a
// credit report before we spend an AI call on it. Scanned/image-based PDFs,
// broken font encodings, and wrong-document uploads tend to produce text that
// is too short, mostly unreadable symbols, or missing any credit-report
// vocabulary at all — catch those here with a clear, actionable message
// instead of silently proceeding to a near-empty Review screen.
// ============================================================================

// A real credit report is a multi-page, multi-account document; a handful of
// characters (a cover page, a scan's OCR sidecar failing, etc.) can't
// plausibly contain one.
export const MIN_PLAUSIBLE_TEXT_LENGTH = 300;

// Minimum ratio of "readable" characters (letters/digits/whitespace/common
// punctuation) required — garbled encodings and OCR noise on image PDFs skew
// heavily toward symbols/control characters instead.
const MIN_READABLE_CHAR_RATIO = 0.75;

// Terms that should appear repeatedly in any genuine credit report; a
// document with almost none of these is either the wrong file or text
// extraction failed outright.
const CREDIT_REPORT_KEYWORDS = /\b(account|credit|balance|payment|inquir|bureau|experian|equifax|transunion|creditor|tradeline|score|collection|mortgage|loan)\b/gi;
const MIN_KEYWORD_MATCHES = 3;

export interface TextQualityAssessment {
  plausible: boolean;
  reason: string | null;
}

/**
 * Assess whether extracted PDF text is plausibly a credit report, before
 * spending an AI extraction call on it. Returns plausible=false with a
 * human-readable reason the coach can act on when the text looks too short,
 * garbled, or unrelated to a credit report.
 */
export function assessExtractedTextQuality(text: string): TextQualityAssessment {
  const trimmed = (text || "").trim();

  if (trimmed.length < MIN_PLAUSIBLE_TEXT_LENGTH) {
    return {
      plausible: false,
      reason:
        `Only ${trimmed.length} character${trimmed.length === 1 ? "" : "s"} of text could be extracted from this PDF — too short to plausibly contain a credit report. ` +
        `The file may be scanned/image-based rather than text-based, or the pages may not have been read correctly. Try re-exporting or re-scanning the PDF with text/OCR enabled.`,
    };
  }

  const readableChars = trimmed.replace(/[^a-zA-Z0-9\s.,$%#/:\-]/g, "").length;
  const readableRatio = readableChars / trimmed.length;
  if (readableRatio < MIN_READABLE_CHAR_RATIO) {
    return {
      plausible: false,
      reason:
        "The extracted text is mostly unrecognized characters, which usually means the PDF uses a font or encoding that couldn't be read correctly (common with scanned or poorly-formatted reports). " +
        "Try re-exporting the PDF from the original source, or provide a text-based export instead of a scan.",
    };
  }

  const keywordMatches = trimmed.match(CREDIT_REPORT_KEYWORDS) || [];
  if (keywordMatches.length < MIN_KEYWORD_MATCHES) {
    return {
      plausible: false,
      reason:
        "The extracted text doesn't contain recognizable credit-report terms (account, balance, bureau, etc.). " +
        "This may not be a credit report, or the PDF's text extraction failed to capture its real content. Please double-check the file and try again.",
    };
  }

  return { plausible: true, reason: null };
}

// Below this many total extracted accounts (accepted + flagged-for-review),
// an extraction is suspicious even if it technically succeeded — most credit
// reports contain many tradelines. This doesn't block the coach, but it
// should surface as a clear warning on the Review screen rather than looking
// like a normal, complete result.
export const MIN_EXPECTED_ACCOUNT_COUNT = 3;

/**
 * Build a coach-facing warning when the number of extracted accounts (after
 * confidence partitioning) is implausibly low for a real credit report.
 * Returns null when the yield looks normal.
 */
export function assessExtractionYield(acceptedCount: number, reviewCount: number): string | null {
  const total = acceptedCount + reviewCount;
  if (total >= MIN_EXPECTED_ACCOUNT_COUNT) return null;

  return (
    `Only ${total} account${total === 1 ? "" : "s"} ${total === 1 ? "was" : "were"} extracted from this report — most credit reports contain ` +
    `many more tradelines. This can happen with scanned/image-based PDFs, multi-column bureau layouts, or unusual ` +
    `report formats that confuse text extraction. Please double-check the original PDF and add any missing ` +
    `accounts manually before finalizing.`
  );
}

/**
 * Splits raw extracted accounts into an accepted list and a hidden review list
 * based on a strictly recomputed confidence score.
 */
export function partitionAccountsByConfidence(
  rawAccounts: any[],
  reportDate: string
): { accounts: CreditAccount[]; reviewAccounts: CreditAccount[] } {
  const accounts: CreditAccount[] = [];
  const reviewAccounts: CreditAccount[] = [];

  for (const raw of Array.isArray(rawAccounts) ? rawAccounts : []) {
    const normalized = normalizeAccount(raw);
    normalized.accountAgeMonths = computeAccountAgeMonths(normalized.dateOpened, reportDate, normalized.accountAgeMonths);
    const confidence = computeAccountConfidence(normalized);
    normalized.confidence = confidence;

    if (confidence >= ACCOUNT_ACCEPTANCE_THRESHOLD) {
      accounts.push(normalized);
    } else {
      reviewAccounts.push(normalized);
    }
  }

  // De-duplicate accepted accounts that represent the same tradeline reported
  // by multiple bureaus — merge their bureausReporting arrays instead of
  // double-counting the debt.
  const deduped: CreditAccount[] = [];
  for (const account of accounts) {
    const nameKey = normalizeNameKey(account.creditorName);
    const numberKey = maskAccountNumber(account.accountNumberMasked);
    const existing = deduped.find(a => {
      const existingNameKey = normalizeNameKey(a.creditorName);
      const existingNumberKey = maskAccountNumber(a.accountNumberMasked);
      if (hasUsableAccountNumber(numberKey) && hasUsableAccountNumber(existingNumberKey)) {
        return existingNumberKey === numberKey && existingNameKey === nameKey;
      }
      return existingNameKey === nameKey && nameKey.length > 0;
    });

    if (existing) {
      const mergedBureaus = new Set([...existing.bureausReporting, ...account.bureausReporting]);
      existing.bureausReporting = Array.from(mergedBureaus);
      existing.currentBalance = existing.currentBalance ?? account.currentBalance;
      existing.creditLimitOrOriginalAmount = existing.creditLimitOrOriginalAmount ?? account.creditLimitOrOriginalAmount;
      existing.latePaymentsLast24Months = Math.max(existing.latePaymentsLast24Months, account.latePaymentsLast24Months);
      continue;
    }

    deduped.push(account);
  }

  return { accounts: deduped, reviewAccounts };
}
