import type { Express, Request, Response } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api } from "@shared/routes";
import {
  finalizeReportSchema,
  processReportSchema,
  type CreditAccount,
  type CreditReportData,
} from "@shared/schema";
import multer from "multer";
import { openai } from "./replit_integrations/audio/client";
import { PDFParse } from "pdf-parse";
import { generateAssessmentPdf } from "./pdf";
import {
  partitionAccountsByConfidence,
  computeAccountAgeMonths,
  assessExtractedTextQuality,
  assessExtractionYield,
} from "./extraction";
import {
  computeAccountSummary,
  computeDebtSummary,
  evaluateFundingReadiness,
  parseBusinessAgeMonths,
} from "./scoring";

// Setup multer for file uploads
const upload = multer({ storage: multer.memoryStorage() });

// PDF Debug Info Type
interface PDFDebugInfo {
  filename: string;
  fileSize: number;
  mimeType: string;
  headerOk: boolean;
  parsersUsed: string[];
  errors: string[];
  charCount: number;
  pagesRead?: number;
}

// Helper: Preprocess text
function preprocessText(text: string): string {
  let cleaned = text.replace(/\r\n/g, "\n");
  cleaned = cleaned.replace(/\n\n+/g, "\n");
  cleaned = cleaned.replace(/  +/g, " ");
  return cleaned.trim();
}

async function parsePdfFile(buffer: Buffer, filename: string, mimeType: string): Promise<{ text: string; debug: PDFDebugInfo }> {
  const debug: PDFDebugInfo = {
    filename,
    fileSize: buffer.length,
    mimeType,
    headerOk: buffer.slice(0, 5).toString("ascii") === "%PDF-",
    parsersUsed: [],
    errors: [],
    charCount: 0,
  };

  let text = "";

  try {
    const parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    text = result.text || "";
    debug.pagesRead = result.pages?.length;
    debug.parsersUsed.push("pdf-parse");
  } catch (error: any) {
    debug.errors.push(`pdf-parse: ${error?.message || String(error)}`);
  }

  text = preprocessText(text);
  debug.charCount = text.length;

  if (!text || text.length < 20) {
    debug.errors.push("Extracted text is empty or too short — the PDF may be scanned/image-based.");
  }

  return { text, debug };
}

// ============================================================================
// AI EXTRACTION — populates the structured data model only. All scoring and
// qualification-rule logic lives in server/scoring.ts as pure deterministic
// functions; the AI is never allowed to invent or apply qualification rules.
// ============================================================================

const EXTRACTION_SYSTEM_PROMPT = `You are a credit report data extraction engine. Your ONLY job is to read the raw text of a credit report and pull out factual data points into a structured JSON object. You do NOT evaluate, score, or judge anything — you only extract what is literally present in the text.

The reports you receive are almost always Experian.com consumer credit reports (the report a person downloads from their own Experian account), NOT a tri-bureau report. Keep these Experian.com-specific conventions in mind:
- There is normally only ONE credit score shown (an Experian FICO Score or Experian VantageScore) — Equifax/TransUnion scores are essentially always absent from this format. Set experianScore from that single score and leave equifaxScore/transunionScore null unless the text genuinely also shows those bureaus' data.
- Every account came from Experian's own data, so set "bureausReporting" to ["Experian"] for every account (Experian.com does not show which other bureaus a given tradeline reports to).
- Accounts are typically grouped into sections such as "Accounts in Good Standing" / "Accounts in Good Standing (Closed)" and "Potentially Negative or Derogatory Items" / "Potentially Negative Items", further broken down by "Revolving Accounts", "Installment Accounts" (or "Installment Loans"), "Real Estate Accounts" / "Mortgage Accounts", and "Other Accounts". Use the section an account is under only as a hint, not a substitute for reading its actual account type and status fields.
- Each account block usually lists fields like: Account Name/Creditor, Account Number (partially masked already, e.g. "xxxxxxxx1234"), Account Type/Loan Type, Account Status, Date Opened, Balance, Credit Limit (revolving) or Original Amount/Highest Balance (installment), Monthly Payment, Terms, Balance Updated date, and a monthly Payment History grid of OK/30/60/90/120/Charge-Off marks per month — use that grid to count "latePaymentsLast24Months".
- "Credit Inquiries" (hard inquiries) are listed as a simple list of company name + date, all against Experian only — treat each line as one inquiry.
- "Public Records" (bankruptcies, judgments, liens) appear as their own section separate from Accounts; map bankruptcy filings to accountType "Bankruptcy Public Record".
- Collection agencies and charged-off tradelines appear under "Potentially Negative Items" with their own balance/status — map to "Collection" or "Charge-Off" per the rules below, not "Other".

General rules:
- Never invent data. If a field cannot be found in the text, use null (or an empty array/0 where appropriate).
- Extract EVERY distinct tradeline/account you can find, including open accounts in good standing, not just negative ones.
- For each account, classify accountType using EXACTLY one of these labels: "Revolving Credit Card", "Charge Card", "Auto Loan", "Student Loan", "Mortgage", "Personal Loan", "Installment Loan", "Credit Builder", "Collection", "Charge-Off", "Bankruptcy Public Record", "Other".
- Only revolving accounts ("Revolving Credit Card" or "Charge Card") should have a credit limit used for utilization; installment-type accounts should use "creditLimitOrOriginalAmount" for the original loan amount, not a revolving limit.
- Do NOT include bureau headers, generic column labels ("Account Name", "Status", "Balance", etc.), or section titles as if they were accounts.
- Mask account numbers to at most the last 4 characters.
- latePaymentsLast24Months should count any 30/60/90+ day late marks that occurred STRICTLY within the last 24 months from the report date — meaning the mark must appear in a month that is 1 to 23 months before the report date. A mark from exactly 24 months before the report date (the same month two years prior) should NOT be counted; only months 1 through 23 months prior qualify.
- Use the credit report's own report date as the anchor for that 24-month lookback. Example: if the report date is 2026-08-15, a late payment in 2024-08 is exactly 24 months old and must NOT be counted; only 2024-09 through 2026-07 qualify.
- When you count any latePaymentsLast24Months, include the specific month/year evidence in lateHistoryNotes so the server and coach can verify the timing.
- Count hard inquiries per bureau, and produce a best-effort estimate of unique inquiries (the same creditor pulling from multiple bureaus around the same date is usually one event, not three). For an Experian-only report, every inquiry counts toward "experian" and estimatedUniqueTotal is simply the count of distinct inquiry lines.

Return a JSON object with this exact shape:
{
  "applicant": {
    "experianScore": number|null,
    "equifaxScore": number|null,
    "transunionScore": number|null
  },
  "accounts": [
    {
      "creditorName": "string - the real creditor/company name",
      "accountNumberMasked": "string - last 4 chars only, or empty string",
      "accountType": "one of the exact labels above",
      "accountStatus": "string - e.g. 'Current', 'Paid as Agreed', 'Charged Off', 'Collection'",
      "openClosed": "Open" | "Closed" | "Unknown",
      "dateOpened": "string date or null",
      "accountAgeMonths": number|null,
      "currentBalance": number|null,
      "creditLimitOrOriginalAmount": number|null,
      "monthlyPayment": number|null,
      "pastDueAmount": number|null,
      "paymentStatus": "string or null",
      "latePaymentsLast24Months": number,
      "lateHistoryNotes": "string or null",
      "bureausReporting": ["Experian"|"Equifax"|"TransUnion", ...],
      "isDerogatory": boolean,
      "includedInBankruptcy": boolean
    }
  ],
  "inquiries": {
    "items": [{ "creditor": "string", "bureau": "Experian"|"Equifax"|"TransUnion"|null, "date": "string or null" }],
    "countByBureau": { "experian": number, "equifax": number, "transunion": number },
    "estimatedUniqueTotal": number|null
  }
}`;

async function extractCreditReportData(extractedText: string): Promise<any> {
  const response = await openai.chat.completions.create({
    model: "gpt-5.1",
    messages: [
      { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
      { role: "user", content: `Extract structured data from this credit report text:\n\n${extractedText.slice(0, 60000)}` },
    ],
    response_format: { type: "json_object" },
  });

  const raw = response.choices[0]?.message?.content || "{}";
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function parseReportDateMonth(reportDate: string): Date | null {
  const isoMatch = reportDate.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/);
  if (isoMatch) {
    return new Date(Number(isoMatch[1]), Number(isoMatch[2]) - 1, 1);
  }

  const slashMatch = reportDate.match(/^(\d{1,2})\/\d{1,2}\/(\d{4})$/);
  if (slashMatch) {
    return new Date(Number(slashMatch[2]), Number(slashMatch[1]) - 1, 1);
  }

  const parsed = new Date(reportDate);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), 1);
}

function monthsBetween(from: Date, to: Date): number {
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

function parseLateHistoryMonths(notes: string | null | undefined): Date[] {
  if (!notes) return [];
  const dates: Date[] = [];
  const seen = new Set<string>();
  const monthNames: Record<string, number> = {
    jan: 0,
    january: 0,
    feb: 1,
    february: 1,
    mar: 2,
    march: 2,
    apr: 3,
    april: 3,
    may: 4,
    jun: 5,
    june: 5,
    jul: 6,
    july: 6,
    aug: 7,
    august: 7,
    sep: 8,
    sept: 8,
    september: 8,
    oct: 9,
    october: 9,
    nov: 10,
    november: 10,
    dec: 11,
    december: 11,
  };

  const addDate = (year: number, month: number) => {
    if (year < 1900 || year > 2200 || month < 0 || month > 11) return;
    const key = `${year}-${month}`;
    if (seen.has(key)) return;
    seen.add(key);
    dates.push(new Date(year, month, 1));
  };

  let match: RegExpExecArray | null;
  const monthYearPattern = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{4})\b/gi;
  while ((match = monthYearPattern.exec(notes)) !== null) {
    addDate(Number(match[2]), monthNames[match[1].toLowerCase()]);
  }

  const numericPattern = /\b(?:(\d{4})[-/](\d{1,2})|(\d{1,2})[-/](\d{4}))\b/g;
  while ((match = numericPattern.exec(notes)) !== null) {
    if (match[1] && match[2]) {
      addDate(Number(match[1]), Number(match[2]) - 1);
    } else if (match[3] && match[4]) {
      addDate(Number(match[4]), Number(match[3]) - 1);
    }
  }

  return dates;
}

function applyLatePaymentLookbackRule(account: CreditAccount, reportDate: string): CreditAccount {
  const currentCount = account.latePaymentsLast24Months || 0;
  if (currentCount <= 0) return account;

  const reportMonth = parseReportDateMonth(reportDate);
  if (!reportMonth) return account;

  const evidenceDates = parseLateHistoryMonths(account.lateHistoryNotes);
  if (evidenceDates.length === 0) return account;

  const qualifyingDates = evidenceDates.filter(date => {
    const ageMonths = monthsBetween(date, reportMonth);
    return ageMonths >= 1 && ageMonths <= 23;
  });

  if (qualifyingDates.length === 0) {
    return {
      ...account,
      latePaymentsLast24Months: 0,
      lateHistoryNotes: `${account.lateHistoryNotes || ""} Excluded from 24-month rule: late-payment date evidence is exactly 24 months old or older from the report date.`.trim(),
    };
  }

  return {
    ...account,
    latePaymentsLast24Months: Math.min(currentCount, qualifyingDates.length),
  };
}

/**
 * Given raw applicant/business/accounts/inquiries data (either freshly extracted
 * or coach-corrected), deterministically recompute every derived field. This is
 * the single source of truth used both right after extraction and after the
 * coach finalizes their review — the client never supplies computed aggregates.
 */
function buildCreditReportData(input: {
  clientName: string;
  reportDate: string;
  applicantScores: { experianScore: number | null; equifaxScore: number | null; transunionScore: number | null };
  businessAgeInput: string | null;
  clientRequests?: string | null;
  businessInformation?: string | null;
  rawAccounts: any[];
  inquiries: any;
  isReviewedAccounts?: boolean;
}): CreditReportData {
  const {
    clientName,
    reportDate,
    applicantScores,
    businessAgeInput,
    clientRequests,
    businessInformation,
    rawAccounts,
    inquiries,
    isReviewedAccounts,
  } = input;

  const applicant = {
    clientName,
    reportDate,
    experianScore: applicantScores.experianScore ?? null,
    equifaxScore: applicantScores.equifaxScore ?? null,
    transunionScore: applicantScores.transunionScore ?? null,
  };

  const business = {
    businessAgeInput: businessAgeInput || null,
    businessAgeMonths: parseBusinessAgeMonths(businessAgeInput),
    clientRequests: clientRequests || null,
    businessInformation: businessInformation || null,
  };

  let accounts: any[];
  let reviewAccounts: any[];
  let extractionWarning: string | null = null;
  if (isReviewedAccounts) {
    // Coach has already reviewed/corrected these — trust them directly, but
    // still recompute derived fields like account age. No extraction warning
    // once a human has confirmed the data.
    accounts = (Array.isArray(rawAccounts) ? rawAccounts : []).map((a: any) => ({
      ...a,
      accountAgeMonths: computeAccountAgeMonths(a.dateOpened, reportDate, a.accountAgeMonths ?? null),
    }));
    reviewAccounts = [];
  } else {
    const partitioned = partitionAccountsByConfidence(rawAccounts, reportDate);
    accounts = partitioned.accounts;
    reviewAccounts = partitioned.reviewAccounts;
    extractionWarning = assessExtractionYield(accounts.length, reviewAccounts.length);
  }

  accounts = accounts.map((account: any) => applyLatePaymentLookbackRule(account, reportDate));
  reviewAccounts = reviewAccounts.map((account: any) => applyLatePaymentLookbackRule(account, reportDate));

  const inquiriesSummary = {
    items: Array.isArray(inquiries?.items) ? inquiries.items : [],
    countByBureau: {
      experian: inquiries?.countByBureau?.experian ?? 0,
      equifax: inquiries?.countByBureau?.equifax ?? 0,
      transunion: inquiries?.countByBureau?.transunion ?? 0,
    },
    estimatedUniqueTotal:
      typeof inquiries?.estimatedUniqueTotal === "number" ? inquiries.estimatedUniqueTotal : null,
  };

  const accountSummary = computeAccountSummary(accounts);
  const debtSummary = computeDebtSummary(accounts);
  const readiness = evaluateFundingReadiness({
    applicant,
    business,
    accounts,
    inquiries: inquiriesSummary,
    accountSummary,
    debtSummary,
  });

  return {
    applicant,
    business,
    accounts,
    reviewAccounts,
    inquiries: inquiriesSummary,
    accountSummary,
    debtSummary,
    readiness,
    extractionWarning,
  };
}

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  app.get(api.reports.list.path, async (_req, res) => {
    const reports = await storage.getReports();
    res.json(reports);
  });

  app.get(api.reports.get.path, async (req: Request, res: Response) => {
    const report = await storage.getReport(Number(req.params.id));
    if (!report) {
      return res.status(404).json({ message: "Report not found" });
    }
    res.json(report);
  });

  app.post(api.reports.process.path, upload.single("file"), async (req: Request, res: Response) => {
    try {
      const file = req.file;
      if (!file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const parsed = processReportSchema.safeParse({
        clientName: req.body.clientName,
        reportDate: req.body.reportDate,
        coachNotes: req.body.coachNotes,
        consentConfirmed: req.body.consentConfirmed === "true" || req.body.consentConfirmed === true,
        businessAgeInput: req.body.businessAgeInput,
        clientRequests: req.body.clientRequests,
        businessInformation: req.body.businessInformation,
      });

      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0]?.message || "Invalid request" });
      }

      const {
        clientName,
        reportDate,
        coachNotes,
        consentConfirmed,
        businessAgeInput,
        clientRequests,
        businessInformation,
      } = parsed.data;

      // 1. Extract raw text from the PDF
      const { text: extractedText, debug } = await parsePdfFile(file.buffer, file.originalname, file.mimetype);

      // Catch scanned/image-based, garbled, or otherwise implausible PDFs
      // before spending an AI call and before a coach ever sees the result —
      // a clear rejection here beats a silently near-empty Review screen.
      const textQuality = assessExtractedTextQuality(extractedText);
      if (!textQuality.plausible) {
        console.warn(`[Extraction] Rejected "${file.originalname}": ${textQuality.reason}`);
        return res.status(400).json({
          message: textQuality.reason || "Could not extract readable text from this PDF. It may be scanned/image-based.",
          debug,
        });
      }

      // 2. AI extraction of the structured data model (facts only, no scoring)
      const extraction = await extractCreditReportData(extractedText);

      // 3. Build the full structured data model with deterministic scoring
      const reportData = buildCreditReportData({
        clientName,
        reportDate,
        applicantScores: extraction.applicant || {},
        businessAgeInput: businessAgeInput || null,
        clientRequests: clientRequests || null,
        businessInformation: businessInformation || null,
        rawAccounts: extraction.accounts || [],
        inquiries: extraction.inquiries || {},
      });

      console.log(
        `[Extraction] ${reportData.accounts.length} accounts accepted, ${reportData.reviewAccounts.length} routed to review for low confidence.`
      );
      if (reportData.extractionWarning) {
        console.warn(`[Extraction] Low yield for "${file.originalname}": ${reportData.extractionWarning}`);
      }

      // 4. Save to database, unfinalized — the coach must review before the
      // final assessment/PDF can be generated from it.
      const report = await storage.createReport({
        clientName,
        reportDate,
        coachNotes: coachNotes || null,
        consentConfirmed,
        extractedText,
        reportData: reportData as any,
        isFinalized: false,
      });

      res.status(201).json(report);
    } catch (error) {
      console.error("Processing error:", error);
      res.status(500).json({ message: "Failed to process report" });
    }
  });

  app.put(api.reports.finalize.path, async (req: Request, res: Response) => {
    try {
      const existing = await storage.getReport(Number(req.params.id));
      if (!existing) {
        return res.status(404).json({ message: "Report not found" });
      }

      const parsed = finalizeReportSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0]?.message || "Invalid request" });
      }

      const { applicant, business, accounts, inquiries } = parsed.data;

      // Recompute every derived field server-side from the coach-corrected
      // data — never trust client-supplied summaries or scoring.
      const reportData = buildCreditReportData({
        clientName: applicant.clientName,
        reportDate: applicant.reportDate,
        applicantScores: applicant,
        businessAgeInput: business.businessAgeInput,
        clientRequests: business.clientRequests,
        businessInformation: business.businessInformation,
        rawAccounts: accounts,
        inquiries,
        isReviewedAccounts: true,
      });

      const updated = await storage.updateReport(existing.id, {
        clientName: applicant.clientName,
        reportDate: applicant.reportDate,
        reportData: reportData as any,
        isFinalized: true,
      });

      res.json(updated);
    } catch (error) {
      console.error("Finalize error:", error);
      res.status(500).json({ message: "Failed to finalize report" });
    }
  });

  app.get(api.reports.downloadPdf.path, async (req: Request, res: Response) => {
    try {
      const report = await storage.getReport(Number(req.params.id));
      if (!report) {
        return res.status(404).json({ message: "Report not found" });
      }
      if (!report.isFinalized) {
        return res.status(400).json({ message: "Report must be reviewed and finalized before generating the PDF." });
      }

      generateAssessmentPdf(report.reportData as CreditReportData, report.coachNotes ?? null, res);
    } catch (error) {
      console.error("PDF generation error:", error);
      if (!res.headersSent) {
        res.status(500).json({ message: "Failed to generate PDF" });
      }
    }
  });

  app.post(api.reports.reextract.path, async (req: Request, res: Response) => {
    try {
      const existing = await storage.getReport(Number(req.params.id));
      if (!existing) {
        return res.status(404).json({ message: "Report not found" });
      }
      if (existing.isFinalized) {
        return res.status(400).json({ message: "Cannot re-run extraction on a finalized report." });
      }
      if (!existing.extractedText || existing.extractedText.trim().length === 0) {
        return res.status(400).json({ message: "No stored extracted text found for this report. Please re-upload the PDF." });
      }

      // Re-check text quality before spending an AI call
      const textQuality = assessExtractedTextQuality(existing.extractedText);
      if (!textQuality.plausible) {
        console.warn(`[Re-extraction] Rejected report ${existing.id}: ${textQuality.reason}`);
        return res.status(400).json({ message: textQuality.reason || "The stored text still does not pass the text-quality check." });
      }

      // Re-run AI extraction against the stored text
      const extraction = await extractCreditReportData(existing.extractedText);

      // Rebuild the full structured data model
      const existingData = existing.reportData as any;
      const reportData = buildCreditReportData({
        clientName: existing.clientName,
        reportDate: existing.reportDate,
        applicantScores: extraction.applicant || {},
        businessAgeInput: existingData?.business?.businessAgeInput ?? null,
        clientRequests: existingData?.business?.clientRequests ?? null,
        businessInformation: existingData?.business?.businessInformation ?? null,
        rawAccounts: extraction.accounts || [],
        inquiries: extraction.inquiries || {},
      });

      console.log(
        `[Re-extraction] Report ${existing.id}: ${reportData.accounts.length} accounts accepted, ${reportData.reviewAccounts.length} routed to review.`
      );
      if (reportData.extractionWarning) {
        console.warn(`[Re-extraction] Low yield for report ${existing.id}: ${reportData.extractionWarning}`);
      }

      const updated = await storage.updateReport(existing.id, {
        reportData: reportData as any,
      });

      res.json(updated);
    } catch (error) {
      console.error("Re-extraction error:", error);
      res.status(500).json({ message: "Failed to re-run extraction" });
    }
  });

  app.get(api.reports.byClient.path, async (req: Request, res: Response) => {
    try {
      const rawName = req.params["name"];
      if (!rawName || typeof rawName !== "string") {
        return res.status(400).json({ message: "Invalid client name" });
      }
      // Express already URL-decodes path params — do not decode again
      const clientName = rawName.trim();
      if (!clientName) {
        return res.status(400).json({ message: "Client name cannot be empty" });
      }
      const reports = await storage.getReportsByClientName(clientName);
      res.json(reports);
    } catch (error) {
      console.error("Client reports error:", error);
      res.status(500).json({ message: "Failed to fetch client reports" });
    }
  });

  app.get(api.settings.get.path, async (_req, res) => {
    const settings = await storage.getSettings();
    res.json(settings);
  });

  app.put(api.settings.update.path, async (req: Request, res: Response) => {
    const updated = await storage.updateSettings(req.body);
    res.json(updated);
  });

  return httpServer;
}
