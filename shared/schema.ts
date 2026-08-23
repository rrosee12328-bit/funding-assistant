import { pgTable, text, serial, timestamp, jsonb, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const creditReports = pgTable("credit_reports", {
  id: serial("id").primaryKey(),
  clientName: text("client_name").notNull(),
  reportDate: text("report_date").notNull(),
  coachNotes: text("coach_notes"),
  consentConfirmed: boolean("consent_confirmed").notNull(),
  // Extracted raw text
  extractedText: text("extracted_text").notNull(),
  // JSON structure of the structured credit-report data model (see creditReportDataSchema below).
  // Starts as raw AI/pattern extraction; becomes coach-corrected data once reviewed.
  reportData: jsonb("report_data").notNull(),
  // True once the coach has reviewed/corrected the data and the final assessment was generated.
  isFinalized: boolean("is_finalized").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertCreditReportSchema = createInsertSchema(creditReports).omit({
  id: true,
  createdAt: true,
});

export type InsertCreditReport = z.infer<typeof insertCreditReportSchema>;
export type CreditReport = typeof creditReports.$inferSelect;

export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id")
    .notNull()
    .references(() => conversations.id),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ============================================================================
// STRUCTURED CREDIT-REPORT DATA MODEL
// ============================================================================

// What the frontend sends to process a PDF (multipart/form-data alongside the file)
export const processReportSchema = z.object({
  clientName: z.string().min(1, "Client name is required"),
  reportDate: z.string().min(1, "Report date is required"),
  coachNotes: z.string().optional(),
  consentConfirmed: z.boolean().refine(val => val === true, "Must confirm consent"),
  // Manual business-age input (see BUSINESS AGE qualification standard)
  businessAgeInput: z.string().optional(), // free text, e.g. "18 months", "2 years", or a start date
  clientRequests: z.string().optional(),
  businessInformation: z.string().optional(),
});
export type ProcessReportRequest = z.infer<typeof processReportSchema>;

export const bureauEnum = z.enum(["Experian", "Equifax", "TransUnion"]);
export type Bureau = z.infer<typeof bureauEnum>;

export const accountTypeEnum = z.enum([
  "Revolving Credit Card",
  "Charge Card",
  "Auto Loan",
  "Student Loan",
  "Mortgage",
  "Personal Loan",
  "Installment Loan",
  "Credit Builder",
  "Collection",
  "Charge-Off",
  "Bankruptcy Public Record",
  "Other",
]);
export type AccountType = z.infer<typeof accountTypeEnum>;

export const readinessStatusEnum = z.enum(["PASS", "CAUTION", "FAIL", "UNKNOWN"]);
export type ReadinessStatus = z.infer<typeof readinessStatusEnum>;

// --- Applicant profile ---
export const applicantProfileSchema = z.object({
  clientName: z.string(),
  reportDate: z.string(),
  experianScore: z.number().nullable(),
  equifaxScore: z.number().nullable(),
  transunionScore: z.number().nullable(),
});
export type ApplicantProfile = z.infer<typeof applicantProfileSchema>;

// --- Manual business-age input ---
export const businessInfoSchema = z.object({
  businessAgeInput: z.string().nullable(), // raw text the coach typed in
  businessAgeMonths: z.number().nullable(), // parsed months, when derivable
  clientRequests: z.string().nullable().default(null),
  businessInformation: z.string().nullable().default(null),
});
export type BusinessInfo = z.infer<typeof businessInfoSchema>;

// --- Per-account record ---
export const creditAccountSchema = z.object({
  id: z.string(),
  creditorName: z.string(),
  accountNumberMasked: z.string(),
  accountType: accountTypeEnum,
  accountStatus: z.string(), // e.g. "Current", "Paid as Agreed", "Charged Off"
  openClosed: z.enum(["Open", "Closed", "Unknown"]),
  dateOpened: z.string().nullable(),
  accountAgeMonths: z.number().nullable(),
  currentBalance: z.number().nullable(),
  creditLimitOrOriginalAmount: z.number().nullable(),
  monthlyPayment: z.number().nullable(),
  pastDueAmount: z.number().nullable(),
  paymentStatus: z.string().nullable(),
  latePaymentsLast24Months: z.number().default(0),
  lateHistoryNotes: z.string().nullable(),
  bureausReporting: z.array(bureauEnum).default([]),
  isDerogatory: z.boolean().default(false),
  includedInBankruptcy: z.boolean().default(false),
  // Extraction confidence 0-100. Accounts below the acceptance threshold are
  // routed to the hidden review list instead of the main account table.
  confidence: z.number().default(100),
});
export type CreditAccount = z.infer<typeof creditAccountSchema>;

// --- Hard inquiries ---
export const inquirySchema = z.object({
  creditor: z.string(),
  bureau: bureauEnum.nullable(),
  date: z.string().nullable(),
});
export type Inquiry = z.infer<typeof inquirySchema>;

export const inquiriesSummarySchema = z.object({
  items: z.array(inquirySchema).default([]),
  countByBureau: z.object({
    experian: z.number().default(0),
    equifax: z.number().default(0),
    transunion: z.number().default(0),
  }),
  estimatedUniqueTotal: z.number().nullable(),
});
export type InquiriesSummary = z.infer<typeof inquiriesSummarySchema>;

// --- Account summary counts ---
export const accountSummarySchema = z.object({
  totalUniqueAccounts: z.number(),
  openAccounts: z.number(),
  closedAccounts: z.number(),
  revolvingAccounts: z.number(),
  installmentAccounts: z.number(),
  mortgageAccounts: z.number(),
  autoLoans: z.number(),
  studentLoans: z.number(),
  personalLoans: z.number(),
  creditBuilderAccounts: z.number(),
  collections: z.number(),
  chargeOffs: z.number(),
  publicRecords: z.number(),
  bankruptcyRecords: z.number(),
});
export type AccountSummary = z.infer<typeof accountSummarySchema>;

// --- Debt summary ---
export const debtSummarySchema = z.object({
  totalRevolvingDebt: z.number(),
  totalInstallmentDebt: z.number(),
  totalMortgageDebt: z.number(),
  totalAutoLoanDebt: z.number(),
  totalStudentLoanDebt: z.number(),
  totalCollectionBalances: z.number(),
  totalChargeOffBalances: z.number(),
  totalReportedDebt: z.number(),
  totalMonthlyDebtPayments: z.number(),
  totalRevolvingLimits: z.number(),
  highestRevolvingLimit: z.number().nullable(),
  averageRevolvingLimit: z.number().nullable(),
  overallRevolvingUtilization: z.number().nullable(), // percentage, e.g. 8.4
});
export type DebtSummary = z.infer<typeof debtSummarySchema>;

// --- Rule-based funding-readiness scoring result ---
export const fundingReadinessCategoryEnum = z.enum([
  "Credit Score",
  "Recent Payment History",
  "Revolving Utilization",
  "Total Account Depth",
  "Revolving Account Age",
  "Revolving Credit Limits",
  "Collections and Charge-Offs",
  "Bankruptcy",
  "Hard Inquiries",
  "Business Age",
]);
export type FundingReadinessCategory = z.infer<typeof fundingReadinessCategoryEnum>;

export const categoryResultSchema = z.object({
  category: fundingReadinessCategoryEnum,
  status: readinessStatusEnum,
  detail: z.string(),
});
export type CategoryResult = z.infer<typeof categoryResultSchema>;

export const overallStatusEnum = z.enum([
  "Funding Ready",
  "Nearly Funding Ready",
  "Not Currently Funding Ready",
]);
export type OverallStatus = z.infer<typeof overallStatusEnum>;

export const fundingReadinessResultSchema = z.object({
  overallStatus: overallStatusEnum,
  categories: z.array(categoryResultSchema),
  strengths: z.array(z.string()).max(4),
  barriers: z.array(z.string()).max(6),
  fundingOptionsNotes: z.array(z.string()).default([]),
});
export type FundingReadinessResult = z.infer<typeof fundingReadinessResultSchema>;

// --- Full structured credit-report data model ---
export const creditReportDataSchema = z.object({
  applicant: applicantProfileSchema,
  business: businessInfoSchema,
  accounts: z.array(creditAccountSchema),
  // Low-confidence / rejected candidates, never shown in the main account table.
  reviewAccounts: z.array(creditAccountSchema).default([]),
  inquiries: inquiriesSummarySchema,
  accountSummary: accountSummarySchema,
  debtSummary: debtSummarySchema,
  readiness: fundingReadinessResultSchema,
  // Set when very few accounts were extracted relative to a typical credit
  // report, so the coach sees a clear warning on the Review screen instead of
  // silently trusting a mostly-empty extraction. Null when extraction yield
  // looked normal (including after the coach has reviewed/finalized).
  extractionWarning: z.string().nullable().default(null),
});
export type CreditReportData = z.infer<typeof creditReportDataSchema>;

// What the Review Extracted Data screen submits to finalize a report.
// Server recomputes accountSummary/debtSummary/readiness from these edited fields —
// the client never gets to hand-supply the final scoring result.
export const finalizeReportSchema = z.object({
  applicant: applicantProfileSchema,
  business: businessInfoSchema,
  accounts: z.array(creditAccountSchema),
  inquiries: inquiriesSummarySchema,
});
export type FinalizeReportRequest = z.infer<typeof finalizeReportSchema>;

// Settings schema for customization (saved in memory or DB later)
export const strategySettingsSchema = z.object({
  disputePhilosophy: z.string(),
  creditBuildingRecommendations: z.string(),
  clientEducationMessaging: z.string(),
  disputeOrder: z.string(),
});
export type StrategySettings = z.infer<typeof strategySettingsSchema>;
