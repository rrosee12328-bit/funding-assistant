// ============================================================================
// RULE-BASED FUNDING-READINESS SCORING ENGINE
//
// Pure, deterministic functions only. No AI calls or AI-influenced judgment
// calls happen anywhere in this file — every threshold below is taken
// directly from the funding-qualification standards the business provided.
// ============================================================================

import {
  type CreditAccount,
  type ApplicantProfile,
  type BusinessInfo,
  type InquiriesSummary,
  type AccountSummary,
  type DebtSummary,
  type CategoryResult,
  type FundingReadinessResult,
  type FundingReadinessCategory,
  type ReadinessStatus,
} from "@shared/schema";

const REVOLVING_TYPES = new Set(["Revolving Credit Card", "Charge Card"]);
const INSTALLMENT_TYPES = new Set([
  "Auto Loan",
  "Student Loan",
  "Mortgage",
  "Personal Loan",
  "Installment Loan",
]);

export function isRevolvingAccount(account: CreditAccount): boolean {
  return REVOLVING_TYPES.has(account.accountType);
}

export function isInstallmentAccount(account: CreditAccount): boolean {
  return INSTALLMENT_TYPES.has(account.accountType);
}

export function isDerogatoryAccount(account: CreditAccount): boolean {
  return (
    account.isDerogatory ||
    account.accountType === "Collection" ||
    account.accountType === "Charge-Off" ||
    account.accountType === "Bankruptcy Public Record"
  );
}

// ----------------------------------------------------------------------------
// Account summary + debt summary — pure aggregation from the account list.
// ----------------------------------------------------------------------------

export function computeAccountSummary(accounts: CreditAccount[]): AccountSummary {
  const count = (pred: (a: CreditAccount) => boolean) => accounts.filter(pred).length;

  return {
    totalUniqueAccounts: accounts.length,
    openAccounts: count(a => a.openClosed === "Open"),
    closedAccounts: count(a => a.openClosed === "Closed"),
    revolvingAccounts: count(isRevolvingAccount),
    installmentAccounts: count(a => INSTALLMENT_TYPES.has(a.accountType) || a.accountType === "Installment Loan"),
    mortgageAccounts: count(a => a.accountType === "Mortgage"),
    autoLoans: count(a => a.accountType === "Auto Loan"),
    studentLoans: count(a => a.accountType === "Student Loan"),
    personalLoans: count(a => a.accountType === "Personal Loan"),
    creditBuilderAccounts: count(a => a.accountType === "Credit Builder"),
    collections: count(a => a.accountType === "Collection"),
    chargeOffs: count(a => a.accountType === "Charge-Off"),
    publicRecords: count(a => a.accountType === "Bankruptcy Public Record"),
    bankruptcyRecords: count(a => a.accountType === "Bankruptcy Public Record" || a.includedInBankruptcy),
  };
}

export function computeDebtSummary(accounts: CreditAccount[]): DebtSummary {
  const sum = (pred: (a: CreditAccount) => boolean, field: keyof CreditAccount) =>
    accounts.filter(pred).reduce((total, a) => total + (Number(a[field]) || 0), 0);

  const revolvingAccounts = accounts.filter(isRevolvingAccount);
  const totalRevolvingDebt = revolvingAccounts.reduce((t, a) => t + (a.currentBalance || 0), 0);
  const totalRevolvingLimits = revolvingAccounts.reduce((t, a) => t + (a.creditLimitOrOriginalAmount || 0), 0);
  const revolvingLimits = revolvingAccounts
    .map(a => a.creditLimitOrOriginalAmount)
    .filter((v): v is number => typeof v === "number" && v > 0);

  const totalInstallmentDebt = sum(a => isInstallmentAccount(a) && a.accountType !== "Mortgage" && a.accountType !== "Auto Loan" && a.accountType !== "Student Loan", "currentBalance");
  const totalMortgageDebt = sum(a => a.accountType === "Mortgage", "currentBalance");
  const totalAutoLoanDebt = sum(a => a.accountType === "Auto Loan", "currentBalance");
  const totalStudentLoanDebt = sum(a => a.accountType === "Student Loan", "currentBalance");
  const totalCollectionBalances = sum(a => a.accountType === "Collection", "currentBalance");
  const totalChargeOffBalances = sum(a => a.accountType === "Charge-Off", "currentBalance");
  const totalMonthlyDebtPayments = accounts.reduce((t, a) => t + (a.monthlyPayment || 0), 0);
  const totalReportedDebt = accounts.reduce((t, a) => t + (a.currentBalance || 0), 0);

  return {
    totalRevolvingDebt,
    totalInstallmentDebt,
    totalMortgageDebt,
    totalAutoLoanDebt,
    totalStudentLoanDebt,
    totalCollectionBalances,
    totalChargeOffBalances,
    totalReportedDebt,
    totalMonthlyDebtPayments,
    totalRevolvingLimits,
    highestRevolvingLimit: revolvingLimits.length ? Math.max(...revolvingLimits) : null,
    averageRevolvingLimit: revolvingLimits.length
      ? revolvingLimits.reduce((a, b) => a + b, 0) / revolvingLimits.length
      : null,
    overallRevolvingUtilization: totalRevolvingLimits > 0 ? (totalRevolvingDebt / totalRevolvingLimits) * 100 : null,
  };
}

// ----------------------------------------------------------------------------
// Business-age parsing (manual input, best-effort, never fabricated)
// ----------------------------------------------------------------------------

export function parseBusinessAgeMonths(rawInput: string | null | undefined): number | null {
  if (!rawInput) return null;
  const text = rawInput.trim().toLowerCase();
  if (!text) return null;

  // "X years Y months" / "X yrs" / "X years"
  const yearsMonthsMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:years?|yrs?)\s*(?:(\d+)\s*(?:months?|mos?))?/);
  if (yearsMonthsMatch) {
    const years = parseFloat(yearsMonthsMatch[1]);
    const months = yearsMonthsMatch[2] ? parseInt(yearsMonthsMatch[2], 10) : 0;
    return Math.round(years * 12 + months);
  }

  // "X months"
  const monthsMatch = text.match(/(\d+(?:\.\d+)?)\s*(?:months?|mos?)/);
  if (monthsMatch) {
    return Math.round(parseFloat(monthsMatch[1]));
  }

  // A date string, e.g. "2023-05-01" or "05/2023" — treat as the business start date.
  const dateMatch = Date.parse(rawInput);
  if (!Number.isNaN(dateMatch)) {
    const start = new Date(dateMatch);
    const now = new Date();
    const months = (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth());
    return months >= 0 ? months : null;
  }

  // Bare number - assume years if small, otherwise months.
  const bareNumberMatch = text.match(/^(\d+(?:\.\d+)?)$/);
  if (bareNumberMatch) {
    const n = parseFloat(bareNumberMatch[1]);
    return n <= 15 ? Math.round(n * 12) : Math.round(n);
  }

  return null;
}

// ----------------------------------------------------------------------------
// Category evaluators — one per qualification-standard category.
// Each returns PASS/CAUTION/FAIL/UNKNOWN with a short human-readable reason.
// UNKNOWN is used whenever the underlying data could not be extracted; it is
// never silently treated as PASS.
// ----------------------------------------------------------------------------

function scoreLevel(score: number): "high" | "mid" | "low" {
  if (score >= 700) return "high";
  if (score >= 680) return "mid";
  return "low";
}

function evaluateCreditScore(applicant: ApplicantProfile): CategoryResult {
  const scores = [applicant.experianScore, applicant.equifaxScore, applicant.transunionScore].filter(
    (s): s is number => typeof s === "number"
  );

  if (scores.length === 0) {
    return { category: "Credit Score", status: "UNKNOWN", detail: "No bureau scores were extracted." };
  }

  const lowest = Math.min(...scores);
  const level = scoreLevel(lowest);
  // Most reports we receive are single-bureau (Experian.com consumer reports), so having
  // only one score present is the norm, not a data-quality problem — only call it out when
  // exactly two scores are missing feels informative; otherwise stay silent.
  const bureauNote = scores.length === 1 ? " (Experian score)" : scores.length === 2 ? " (2 bureau scores)" : "";

  if (level === "high") {
    return { category: "Credit Score", status: "PASS", detail: `Lowest bureau score is ${lowest} (700+, strong funding position)${bureauNote}.` };
  }
  if (level === "mid") {
    return { category: "Credit Score", status: "CAUTION", detail: `Lowest bureau score is ${lowest} (meets the 680 minimum but below 700)${bureauNote}.` };
  }
  return { category: "Credit Score", status: "FAIL", detail: `Lowest bureau score is ${lowest}, below the 680 preferred minimum${bureauNote}.` };
}

function evaluateRecentPaymentHistory(accounts: CreditAccount[]): CategoryResult {
  if (accounts.length === 0) {
    return { category: "Recent Payment History", status: "UNKNOWN", detail: "No accounts were extracted to check payment history." };
  }
  const lateAccounts = accounts.filter(a => (a.latePaymentsLast24Months || 0) > 0);
  if (lateAccounts.length === 0) {
    return { category: "Recent Payment History", status: "PASS", detail: "No late payments reported within the last 24 months." };
  }
  const names = lateAccounts.map(a => a.creditorName).slice(0, 4).join(", ");
  return {
    category: "Recent Payment History",
    status: "FAIL",
    detail: `Late payments within the last 24 months on: ${names}${lateAccounts.length > 4 ? ", and others" : ""}.`,
  };
}

function evaluateRevolvingUtilization(debtSummary: DebtSummary, accountSummary: AccountSummary): CategoryResult {
  if (accountSummary.revolvingAccounts === 0 || debtSummary.overallRevolvingUtilization === null) {
    return { category: "Revolving Utilization", status: "UNKNOWN", detail: "No revolving accounts with balance and limit data were found." };
  }
  const utilization = debtSummary.overallRevolvingUtilization;
  const rounded = Math.round(utilization * 10) / 10;
  if (utilization < 10) {
    return { category: "Revolving Utilization", status: "PASS", detail: `Overall revolving utilization is ${rounded}% (below the 10% target).` };
  }
  if (utilization < 30) {
    return { category: "Revolving Utilization", status: "CAUTION", detail: `Overall revolving utilization is ${rounded}% (above the 10% target).` };
  }
  return { category: "Revolving Utilization", status: "FAIL", detail: `Overall revolving utilization is ${rounded}% (well above the 10% target).` };
}

function evaluateTotalAccountDepth(accountSummary: AccountSummary): CategoryResult {
  if (accountSummary.totalUniqueAccounts === 0) {
    return { category: "Total Account Depth", status: "UNKNOWN", detail: "No accounts were extracted from the report." };
  }
  const total = accountSummary.totalUniqueAccounts;
  if (total >= 8) {
    return { category: "Total Account Depth", status: "PASS", detail: `${total} total unique accounts (meets the 8-10+ preferred profile).` };
  }
  if (total >= 5) {
    return { category: "Total Account Depth", status: "CAUTION", detail: `${total} total unique accounts (below the 8-10+ preferred profile).` };
  }
  return { category: "Total Account Depth", status: "FAIL", detail: `Only ${total} total unique accounts (well below the 8-10+ preferred profile).` };
}

function evaluateRevolvingAccountAge(accounts: CreditAccount[]): CategoryResult {
  const revolving = accounts.filter(isRevolvingAccount);
  if (revolving.length === 0) {
    return { category: "Revolving Account Age", status: "UNKNOWN", detail: "No revolving credit-card accounts were found." };
  }
  const withKnownAge = revolving.filter(a => typeof a.accountAgeMonths === "number");
  if (withKnownAge.length === 0) {
    return { category: "Revolving Account Age", status: "UNKNOWN", detail: "Revolving accounts were found, but account age could not be determined." };
  }
  const qualifying = withKnownAge.filter(a => (a.accountAgeMonths || 0) >= 24);
  if (qualifying.length >= 2) {
    return { category: "Revolving Account Age", status: "PASS", detail: `${qualifying.length} revolving accounts have 24+ months of history.` };
  }
  if (qualifying.length === 1) {
    return { category: "Revolving Account Age", status: "CAUTION", detail: "Only 1 revolving account has 24+ months of history (2 preferred)." };
  }
  return { category: "Revolving Account Age", status: "FAIL", detail: "No revolving accounts have reached 24 months of history." };
}

function evaluateRevolvingCreditLimits(debtSummary: DebtSummary, accountSummary: AccountSummary): CategoryResult {
  if (accountSummary.revolvingAccounts === 0 || debtSummary.averageRevolvingLimit === null) {
    return { category: "Revolving Credit Limits", status: "UNKNOWN", detail: "No revolving account limit data was found." };
  }
  const avg = debtSummary.averageRevolvingLimit;
  const rounded = Math.round(avg);
  if (avg >= 5000) {
    return { category: "Revolving Credit Limits", status: "PASS", detail: `Average revolving limit is $${rounded.toLocaleString()} (at or above the $5,000 stronger tier).` };
  }
  if (avg >= 2000) {
    return { category: "Revolving Credit Limits", status: "PASS", detail: `Average revolving limit is $${rounded.toLocaleString()} (within the $2,000-$5,000 preferred range).` };
  }
  if (avg >= 500) {
    return { category: "Revolving Credit Limits", status: "CAUTION", detail: `Average revolving limit is $${rounded.toLocaleString()} (below the $2,000-$5,000 preferred range).` };
  }
  return { category: "Revolving Credit Limits", status: "FAIL", detail: `Average revolving limit is $${rounded.toLocaleString()} (far below the $2,000-$5,000 preferred range).` };
}

function evaluateCollectionsAndChargeOffs(accountSummary: AccountSummary, accounts: CreditAccount[]): CategoryResult {
  if (accounts.length === 0) {
    return { category: "Collections and Charge-Offs", status: "UNKNOWN", detail: "No accounts were extracted from the report." };
  }
  const total = accountSummary.collections + accountSummary.chargeOffs;
  if (total === 0) {
    return { category: "Collections and Charge-Offs", status: "PASS", detail: "No collections or charge-offs detected." };
  }
  const names = accounts
    .filter(a => a.accountType === "Collection" || a.accountType === "Charge-Off")
    .map(a => a.creditorName)
    .slice(0, 4)
    .join(", ");
  return {
    category: "Collections and Charge-Offs",
    status: "FAIL",
    detail: `${accountSummary.collections} collection(s) and ${accountSummary.chargeOffs} charge-off(s) detected: ${names}.`,
  };
}

function evaluateBankruptcy(accountSummary: AccountSummary, accounts: CreditAccount[]): CategoryResult {
  if (accounts.length === 0) {
    return { category: "Bankruptcy", status: "UNKNOWN", detail: "No accounts were extracted from the report." };
  }
  if (accountSummary.bankruptcyRecords === 0) {
    return { category: "Bankruptcy", status: "PASS", detail: "No bankruptcy records detected." };
  }
  const names = accounts
    .filter(a => a.accountType === "Bankruptcy Public Record" || a.includedInBankruptcy)
    .map(a => a.creditorName)
    .slice(0, 4)
    .join(", ");
  return { category: "Bankruptcy", status: "FAIL", detail: `Bankruptcy record(s) detected: ${names}.` };
}

function evaluateHardInquiries(inquiries: InquiriesSummary): CategoryResult {
  if (inquiries.estimatedUniqueTotal === null) {
    return { category: "Hard Inquiries", status: "UNKNOWN", detail: "Hard inquiry count could not be determined." };
  }
  const total = inquiries.estimatedUniqueTotal;
  if (total <= 4) {
    return { category: "Hard Inquiries", status: "PASS", detail: `${total} unique hard inquiries (within the 3-4 preferred maximum).` };
  }
  if (total <= 6) {
    return { category: "Hard Inquiries", status: "CAUTION", detail: `${total} unique hard inquiries (above the 3-4 preferred maximum).` };
  }
  return { category: "Hard Inquiries", status: "FAIL", detail: `${total} unique hard inquiries (well above the 3-4 preferred maximum).` };
}

function evaluateBusinessAge(business: BusinessInfo): CategoryResult {
  if (business.businessAgeMonths === null) {
    return { category: "Business Age", status: "UNKNOWN", detail: "Business age was not provided." };
  }
  const months = business.businessAgeMonths;
  if (months >= 24) {
    return { category: "Business Age", status: "PASS", detail: `Business has been operating for ${months} months (2+ years).` };
  }
  if (months >= 12) {
    return { category: "Business Age", status: "CAUTION", detail: `Business has been operating for ${months} months (1-2 years; some banks require 2+).` };
  }
  return { category: "Business Age", status: "CAUTION", detail: `Business has been operating for ${months} months (under 1 year; depends heavily on the bank).` };
}

// ----------------------------------------------------------------------------
// Overall rollup
// ----------------------------------------------------------------------------

const MUST_PASS_CATEGORIES: FundingReadinessCategory[] = [
  "Credit Score",
  "Recent Payment History",
  "Revolving Utilization",
  "Collections and Charge-Offs",
  "Bankruptcy",
  "Hard Inquiries",
];
const SEVERE_CATEGORIES: FundingReadinessCategory[] = [
  "Recent Payment History",
  "Collections and Charge-Offs",
  "Bankruptcy",
];
const ESTABLISHED_CATEGORIES: FundingReadinessCategory[] = [
  "Total Account Depth",
  "Revolving Account Age",
  "Revolving Credit Limits",
];

function statusOf(categories: CategoryResult[], name: FundingReadinessCategory): ReadinessStatus {
  return categories.find(c => c.category === name)?.status ?? "UNKNOWN";
}

function computeOverallStatus(categories: CategoryResult[]): FundingReadinessResult["overallStatus"] {
  const failCount = categories.filter(c => c.status === "FAIL").length;
  const severeFail = SEVERE_CATEGORIES.some(c => statusOf(categories, c) === "FAIL") || statusOf(categories, "Credit Score") === "FAIL";

  if (severeFail || failCount >= 3) {
    return "Not Currently Funding Ready";
  }

  const allMustPassOk = MUST_PASS_CATEGORIES.every(c => statusOf(categories, c) === "PASS");
  const establishedOk = ESTABLISHED_CATEGORIES.every(c => {
    const s = statusOf(categories, c);
    return s === "PASS" || s === "CAUTION";
  });

  if (allMustPassOk && establishedOk) {
    return "Funding Ready";
  }

  return "Nearly Funding Ready";
}

function buildStrengthsAndBarriers(categories: CategoryResult[]): { strengths: string[]; barriers: string[] } {
  const strengths = categories
    .filter(c => c.status === "PASS")
    .map(c => `${c.category}: ${c.detail}`)
    .slice(0, 4);

  const barriers = categories
    .filter(c => c.status === "CAUTION" || c.status === "FAIL" || c.status === "UNKNOWN")
    .sort((a, b) => {
      const rank: Record<ReadinessStatus, number> = { FAIL: 0, CAUTION: 1, UNKNOWN: 2, PASS: 3 };
      return rank[a.status] - rank[b.status];
    })
    .map(c => `${c.category} (${c.status}): ${c.detail}`)
    .slice(0, 6);

  return { strengths, barriers };
}

export function evaluateFundingReadiness(input: {
  applicant: ApplicantProfile;
  business: BusinessInfo;
  accounts: CreditAccount[];
  inquiries: InquiriesSummary;
  accountSummary: AccountSummary;
  debtSummary: DebtSummary;
}): FundingReadinessResult {
  const { applicant, business, accounts, inquiries, accountSummary, debtSummary } = input;

  const categories: CategoryResult[] = [
    evaluateCreditScore(applicant),
    evaluateRecentPaymentHistory(accounts),
    evaluateRevolvingUtilization(debtSummary, accountSummary),
    evaluateTotalAccountDepth(accountSummary),
    evaluateRevolvingAccountAge(accounts),
    evaluateRevolvingCreditLimits(debtSummary, accountSummary),
    evaluateCollectionsAndChargeOffs(accountSummary, accounts),
    evaluateBankruptcy(accountSummary, accounts),
    evaluateHardInquiries(inquiries),
    evaluateBusinessAge(business),
  ];

  const overallStatus = computeOverallStatus(categories);
  const { strengths, barriers } = buildStrengthsAndBarriers(categories);

  return { overallStatus, categories, strengths, barriers };
}
