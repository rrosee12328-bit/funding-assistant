// ============================================================================
// PDF GENERATION — Funding Readiness Assessment
// Uses @react-pdf/renderer to produce a visual layout that mirrors the
// website's ReportDetails page. Never called on unfinalized data.
// ============================================================================

import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToStream,
} from "@react-pdf/renderer";
import type { Response } from "express";
import type {
  CreditReportData,
  CategoryResult,
  ReadinessStatus,
} from "@shared/schema";
import { normalizeAccountStatus } from "./extraction";

// ---------------------------------------------------------------------------
// Design tokens (mirroring the website's palette, adapted for print)
// ---------------------------------------------------------------------------
const C = {
  primary: "#e91e8c",
  primaryLight: "#fce7f3",
  navy: "#0f172a",
  navyMid: "#1e293b",
  textPrimary: "#0f172a",
  textSecondary: "#475569",
  border: "#e2e8f0",
  cardBg: "#f8fafc",
  white: "#ffffff",

  green: "#15803d",
  greenBg: "#dcfce7",
  greenBorder: "#86efac",

  amber: "#92400e",
  amberBg: "#fef3c7",
  amberBorder: "#fcd34d",

  red: "#991b1b",
  redBg: "#fee2e2",
  redBorder: "#fca5a5",

  slate: "#374151",
  slateBg: "#f3f4f6",
  slateBorder: "#d1d5db",

  tableHeader: "#f1f5f9",
  tableRowAlt: "#f8fafc",
  divider: "#e2e8f0",
};

const STATUS_COLORS: Record<
  ReadinessStatus,
  { text: string; bg: string; border: string }
> = {
  PASS: { text: C.green, bg: C.greenBg, border: C.greenBorder },
  CAUTION: { text: C.amber, bg: C.amberBg, border: C.amberBorder },
  FAIL: { text: C.red, bg: C.redBg, border: C.redBorder },
  UNKNOWN: { text: C.slate, bg: C.slateBg, border: C.slateBorder },
};

function overallStatusColor(status: string): {
  text: string;
  bg: string;
  border: string;
} {
  if (status === "Funding Ready")
    return { text: C.green, bg: C.greenBg, border: C.greenBorder };
  if (status === "Nearly Funding Ready")
    return { text: C.amber, bg: C.amberBg, border: C.amberBorder };
  return { text: C.red, bg: C.redBg, border: C.redBorder };
}

function money(n: number | null | undefined): string {
  if (n === null || n === undefined) return "N/A";
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function pct(n: number | null | undefined): string {
  if (n === null || n === undefined) return "N/A";
  return `${Math.round(n * 10) / 10}%`;
}

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------
const s = StyleSheet.create({
  page: {
    backgroundColor: C.white,
    paddingTop: 48,
    paddingBottom: 56,
    paddingHorizontal: 40,
    fontFamily: "Helvetica",
    fontSize: 9,
    color: C.textPrimary,
  },

  // Header band
  headerBand: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 2,
    borderBottomColor: C.primary,
    paddingBottom: 12,
    marginBottom: 16,
  },
  brandDot: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: C.primary,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  brandDotText: {
    color: C.white,
    fontFamily: "Helvetica-Bold",
    fontSize: 14,
  },
  brandName: {
    fontFamily: "Helvetica-Bold",
    fontSize: 13,
    color: C.navy,
  },
  brandSub: {
    fontSize: 7,
    color: C.textSecondary,
    letterSpacing: 1,
  },
  reportTitle: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    color: C.primary,
    textAlign: "right",
    letterSpacing: 0.5,
  },
  reportMeta: {
    fontSize: 8,
    color: C.textSecondary,
    textAlign: "right",
    marginTop: 2,
  },

  // Cards
  card: {
    backgroundColor: C.cardBg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    padding: 14,
    marginBottom: 12,
  },
  cardTitle: {
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    color: C.navy,
    marginBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.divider,
    paddingBottom: 6,
  },

  // Overall status
  statusCard: {
    borderRadius: 8,
    borderWidth: 2,
    padding: 14,
    marginBottom: 12,
  },
  statusLabel: {
    fontSize: 7,
    letterSpacing: 1.5,
    color: C.textSecondary,
    marginBottom: 4,
  },
  statusText: {
    fontFamily: "Helvetica-Bold",
    fontSize: 20,
  },

  // Bureau score boxes
  scoreRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 10,
  },
  scoreBox: {
    flex: 1,
    backgroundColor: C.white,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: C.border,
    padding: 10,
    alignItems: "center",
  },
  scoreValue: {
    fontFamily: "Helvetica-Bold",
    fontSize: 18,
    color: C.primary,
  },
  scoreLabel: {
    fontSize: 7,
    color: C.textSecondary,
    marginTop: 3,
  },

  // Two-column layout
  twoCol: {
    flexDirection: "row",
    gap: 12,
  },
  colMain: {
    flex: 2,
  },
  colSide: {
    flex: 1,
  },

  // Category rows
  categoryRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 6,
    marginBottom: 4,
  },
  badgePill: {
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    minWidth: 48,
    alignItems: "center",
  },
  badgeText: {
    fontFamily: "Helvetica-Bold",
    fontSize: 6.5,
    letterSpacing: 0.3,
  },
  catName: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8.5,
    color: C.textPrimary,
  },
  catDetail: {
    fontSize: 7.5,
    color: C.textSecondary,
    marginTop: 1,
    lineHeight: 1.4,
  },

  // Bullet list
  bulletRow: {
    flexDirection: "row",
    gap: 5,
    marginBottom: 5,
  },
  bulletDot: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    lineHeight: 1.3,
  },
  bulletText: {
    flex: 1,
    fontSize: 8,
    color: C.textSecondary,
    lineHeight: 1.4,
  },

  // Side-by-side cards (strengths/barriers)
  halfCard: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
    marginBottom: 12,
  },
  halfCardTitle: {
    fontFamily: "Helvetica-Bold",
    fontSize: 10,
    marginBottom: 8,
  },

  // Summary rows
  summaryRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: C.divider,
  },
  summaryLabel: {
    fontSize: 8,
    color: C.textSecondary,
  },
  summaryValue: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    color: C.textPrimary,
  },

  // Table
  tableHeader: {
    flexDirection: "row",
    backgroundColor: C.tableHeader,
    borderRadius: 4,
    paddingVertical: 5,
    paddingHorizontal: 4,
    marginBottom: 2,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 5,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: C.divider,
  },
  tableHeaderText: {
    fontFamily: "Helvetica-Bold",
    fontSize: 7,
    color: C.textSecondary,
  },
  tableCell: {
    fontSize: 7.5,
    color: C.textPrimary,
  },
  tableCellMuted: {
    fontSize: 7.5,
    color: C.textSecondary,
  },

  // Divider
  dividerLine: {
    borderBottomWidth: 1,
    borderBottomColor: C.divider,
    marginVertical: 6,
  },

  // Footer
  footer: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    textAlign: "center",
    fontSize: 7,
    color: C.textSecondary,
    borderTopWidth: 1,
    borderTopColor: C.divider,
    paddingTop: 6,
  },
});

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function Header({ data }: { data: CreditReportData }) {
  return (
    <View style={s.headerBand}>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <View style={s.brandDot}>
          <Text style={s.brandDotText}>R</Text>
        </View>
        <View>
          <Text style={s.brandName}>Rose Finance</Text>
          <Text style={s.brandSub}>ACADEMY PORTAL</Text>
        </View>
      </View>
      <View>
        <Text style={s.reportTitle}>BUSINESS FUNDING READINESS ASSESSMENT</Text>
        <Text style={s.reportMeta}>
          {data.applicant.clientName}{"  ·  "}Report Date: {data.applicant.reportDate}
        </Text>
      </View>
    </View>
  );
}

function OverallStatus({ status }: { status: string }) {
  const colors = overallStatusColor(status);
  return (
    <View
      style={[
        s.statusCard,
        { backgroundColor: colors.bg, borderColor: colors.border },
      ]}
    >
      <Text style={s.statusLabel}>OVERALL STATUS</Text>
      <Text style={[s.statusText, { color: colors.text }]}>{status}</Text>
    </View>
  );
}

function BureauScores({ applicant }: { applicant: CreditReportData["applicant"] }) {
  const boxes = [
    { label: "Experian", value: applicant.experianScore },
    { label: "Equifax", value: applicant.equifaxScore },
    { label: "TransUnion", value: applicant.transunionScore },
  ];
  return (
    <View style={s.scoreRow}>
      {boxes.map((b) => (
        <View key={b.label} style={s.scoreBox}>
          <Text style={s.scoreValue}>{b.value ?? "N/A"}</Text>
          <Text style={s.scoreLabel}>{b.label}</Text>
        </View>
      ))}
    </View>
  );
}

function QualificationChecklist({
  categories,
}: {
  categories: CategoryResult[];
}) {
  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>Qualification Checklist</Text>
      {categories.map((cat) => {
        const colors = STATUS_COLORS[cat.status];
        return (
          <View
            key={cat.category}
            style={[s.categoryRow, { backgroundColor: colors.bg }]}
          >
            <View
              style={[
                s.badgePill,
                { backgroundColor: colors.bg, borderColor: colors.border },
              ]}
            >
              <Text style={[s.badgeText, { color: colors.text }]}>
                {cat.status}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.catName}>{cat.category}</Text>
              <Text style={s.catDetail}>{cat.detail}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

function StrengthsBarriers({ data }: { data: CreditReportData }) {
  return (
    <View style={{ flexDirection: "row", gap: 10, marginBottom: 12 }}>
      <View
        style={[
          s.halfCard,
          { backgroundColor: C.greenBg, borderColor: C.greenBorder },
        ]}
      >
        <Text style={[s.halfCardTitle, { color: C.green }]}>✓  Strengths</Text>
        {data.readiness.strengths.length === 0 ? (
          <Text style={s.bulletText}>None identified yet.</Text>
        ) : (
          data.readiness.strengths.map((str, i) => (
            <View key={i} style={s.bulletRow}>
              <Text style={[s.bulletDot, { color: C.green }]}>•</Text>
              <Text style={s.bulletText}>{str}</Text>
            </View>
          ))
        )}
      </View>

      <View
        style={[
          s.halfCard,
          { backgroundColor: C.amberBg, borderColor: C.amberBorder },
        ]}
      >
        <Text style={[s.halfCardTitle, { color: C.amber }]}>
          ⚠  Barriers to Address
        </Text>
        {data.readiness.barriers.length === 0 ? (
          <Text style={s.bulletText}>No barriers identified.</Text>
        ) : (
          data.readiness.barriers.map((bar, i) => (
            <View key={i} style={s.bulletRow}>
              <Text style={[s.bulletDot, { color: C.amber }]}>•</Text>
              <Text style={s.bulletText}>{bar}</Text>
            </View>
          ))
        )}
      </View>
    </View>
  );
}

function FundingOptionsNotes({ data }: { data: CreditReportData }) {
  const fundingOptionsNotes = data.readiness.fundingOptionsNotes ?? [];
  if (fundingOptionsNotes.length === 0) return null;

  return (
    <View style={[s.card, { borderColor: C.primary, borderWidth: 1.5 }]}>
      <Text style={[s.cardTitle, { color: C.primary }]}>Funding Options Notes</Text>
      {fundingOptionsNotes.map((note, i) => (
        <View key={i} style={s.bulletRow}>
          <Text style={[s.bulletDot, { color: C.primary }]}>•</Text>
          <Text style={s.bulletText}>{note}</Text>
        </View>
      ))}
    </View>
  );
}

function BusinessContext({ data }: { data: CreditReportData }) {
  const clientRequests = data.business.clientRequests ?? null;
  const businessInformation = data.business.businessInformation ?? null;
  if (!clientRequests && !businessInformation) return null;

  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>Client & Business Context</Text>
      {clientRequests ? (
        <View style={{ marginBottom: 8 }}>
          <Text style={s.catName}>Client Requests</Text>
          <Text style={s.catDetail}>{clientRequests}</Text>
        </View>
      ) : null}
      {businessInformation ? (
        <View>
          <Text style={s.catName}>Business Information</Text>
          <Text style={s.catDetail}>{businessInformation}</Text>
        </View>
      ) : null}
    </View>
  );
}

function DebtSummary({ data }: { data: CreditReportData }) {
  const ds = data.debtSummary;
  const rows: [string, string][] = [
    ["Total Reported Debt", money(ds.totalReportedDebt)],
    ["Revolving Debt", money(ds.totalRevolvingDebt)],
    ["Revolving Limits", money(ds.totalRevolvingLimits)],
    ["Revolving Utilization", pct(ds.overallRevolvingUtilization)],
    ["Installment Debt", money(ds.totalInstallmentDebt)],
    ["Mortgage Debt", money(ds.totalMortgageDebt)],
    ["Auto Loan Debt", money(ds.totalAutoLoanDebt)],
    ["Student Loan Debt", money(ds.totalStudentLoanDebt)],
    ["Collection Balances", money(ds.totalCollectionBalances)],
    ["Charge-Off Balances", money(ds.totalChargeOffBalances)],
    ["Monthly Payments", money(ds.totalMonthlyDebtPayments)],
  ];
  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>Debt Summary</Text>
      {rows.map(([label, value]) => (
        <View key={label} style={s.summaryRow}>
          <Text style={s.summaryLabel}>{label}</Text>
          <Text style={s.summaryValue}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

function AccountSummary({ data }: { data: CreditReportData }) {
  const as = data.accountSummary;
  const rows: [string, string][] = [
    ["Total Accounts", String(as.totalUniqueAccounts)],
    ["Open", String(as.openAccounts)],
    ["Closed", String(as.closedAccounts)],
    ["Revolving", String(as.revolvingAccounts)],
    ["Collections", String(as.collections)],
    ["Charge-Offs", String(as.chargeOffs)],
    ["Bankruptcy Records", String(as.bankruptcyRecords)],
    [
      "Unique Inquiries",
      data.inquiries.estimatedUniqueTotal?.toString() ?? "Unknown",
    ],
    [
      "Business Age",
      data.business.businessAgeMonths !== null
        ? `${data.business.businessAgeMonths} months`
        : "Unknown",
    ],
  ];
  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>Account Summary</Text>
      {rows.map(([label, value]) => (
        <View key={label} style={s.summaryRow}>
          <Text style={s.summaryLabel}>{label}</Text>
          <Text style={s.summaryValue}>{value}</Text>
        </View>
      ))}
    </View>
  );
}

// Column widths for the accounts table (in points, total ~= page width - 2x40 margins = 515)
const COL = {
  creditor: 105,
  accountNumber: 54,
  type: 78,
  status: 61,
  opened: 50,
  balance: 48,
  limit: 48,
  util: 44,
};

function AccountsTable({ data }: { data: CreditReportData }) {
  const allAccounts = data.accounts;
  const formatAccountNumber = (value: string | null | undefined) => {
    const trimmed = (value || "").trim();
    return trimmed && !/^n\/?a$/i.test(trimmed) ? trimmed : "-";
  };

  return (
    <View style={s.card}>
      <Text style={s.cardTitle}>All Accounts</Text>

      {/* Header row */}
      <View style={s.tableHeader}>
        <Text style={[s.tableHeaderText, { width: COL.creditor }]}>Account</Text>
        <Text style={[s.tableHeaderText, { width: COL.accountNumber }]}>Acct #</Text>
        <Text style={[s.tableHeaderText, { width: COL.type }]}>Type</Text>
        <Text style={[s.tableHeaderText, { width: COL.status }]}>Status</Text>
        <Text style={[s.tableHeaderText, { width: COL.opened }]}>Opened</Text>
        <Text style={[s.tableHeaderText, { width: COL.balance, textAlign: "right" }]}>Balance</Text>
        <Text style={[s.tableHeaderText, { width: COL.limit, textAlign: "right" }]}>Limit/Orig</Text>
        <Text style={[s.tableHeaderText, { width: COL.util, textAlign: "right" }]}>Util</Text>
      </View>

      {allAccounts.length === 0 && (
        <Text style={[s.tableCellMuted, { paddingVertical: 8, textAlign: "center" }]}>
          No accounts found.
        </Text>
      )}

      {allAccounts.map((acc, idx) => {
        const isRevolving =
          acc.accountType === "Revolving Credit Card" ||
          acc.accountType === "Charge Card";
        const util =
          isRevolving &&
          acc.currentBalance !== null &&
          acc.creditLimitOrOriginalAmount
            ? `${Math.round((acc.currentBalance / acc.creditLimitOrOriginalAmount) * 1000) / 10}%`
            : "—";
        const isDero = acc.isDerogatory;

        return (
          <View
            key={acc.id ?? idx}
            style={[
              s.tableRow,
              idx % 2 === 1 ? { backgroundColor: C.tableRowAlt } : {},
              isDero ? { backgroundColor: "#fff5f5" } : {},
            ]}
          >
            <View style={{ width: COL.creditor }}>
              <Text style={[s.tableCell, isDero ? { color: C.red } : {}]}>
                {acc.creditorName}
              </Text>
            </View>
            <Text style={[s.tableCellMuted, { width: COL.accountNumber }]}>
              {formatAccountNumber(acc.accountNumberMasked)}
            </Text>
            <Text style={[s.tableCellMuted, { width: COL.type }]}>
              {acc.accountType}
            </Text>
            <Text style={[s.tableCellMuted, { width: COL.status }]}>
              {normalizeAccountStatus(acc.accountStatus)}
            </Text>
            <Text style={[s.tableCellMuted, { width: COL.opened }]}>
              {acc.dateOpened ?? "—"}
            </Text>
            <Text
              style={[s.tableCell, { width: COL.balance, textAlign: "right" }]}
            >
              {acc.currentBalance !== null ? money(acc.currentBalance) : "—"}
            </Text>
            <Text
              style={[s.tableCellMuted, { width: COL.limit, textAlign: "right" }]}
            >
              {acc.creditLimitOrOriginalAmount !== null
                ? money(acc.creditLimitOrOriginalAmount)
                : "—"}
            </Text>
            <Text
              style={[s.tableCellMuted, { width: COL.util, textAlign: "right" }]}
            >
              {util}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function CoachNotes({ notes }: { notes: string }) {
  return (
    <View style={[s.card, { borderColor: C.primary, borderWidth: 1.5, marginBottom: 12 }]}>
      <Text style={[s.cardTitle, { color: C.primary }]}>Coach Notes</Text>
      <Text style={{ fontSize: 8.5, color: C.textPrimary, lineHeight: 1.6 }}>{notes}</Text>
    </View>
  );
}

function Disclaimer({ clientName }: { clientName: string }) {
  return (
    <View style={{ marginTop: 8 }}>
      <Text
        style={{
          fontSize: 7,
          color: C.textSecondary,
          lineHeight: 1.5,
          borderTopWidth: 1,
          borderTopColor: C.divider,
          paddingTop: 8,
        }}
      >
        This assessment reflects general funding-readiness qualification
        standards used across common small-business lenders and is not a
        guarantee of approval by any specific bank or lender. Final funding
        decisions rest solely with the lender underwriting your application.
        Generated for {clientName} by Rose Finance Academy.
      </Text>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Root document
// ---------------------------------------------------------------------------

function AssessmentDocument({ data, coachNotes }: { data: CreditReportData; coachNotes: string | null }) {
  return (
    <Document
      title={`${data.applicant.clientName} — Funding Readiness Assessment`}
      author="Rose Finance Academy"
    >
      {/* ── Page 1: Header + Status + Scores + Checklist + Debt sidebar ── */}
      <Page size="A4" style={s.page}>
        <Header data={data} />

        {/* Status + bureau scores (full width) */}
        <OverallStatus status={data.readiness.overallStatus} />
        <BureauScores applicant={data.applicant} />

        <View style={{ height: 12 }} />

        {/* Two-column: checklist | debt + account summary */}
        <View style={s.twoCol}>
          <View style={s.colMain}>
            <QualificationChecklist categories={data.readiness.categories} />
          </View>
          <View style={s.colSide}>
            <DebtSummary data={data} />
            <AccountSummary data={data} />
          </View>
        </View>

        <Text
          style={s.footer}
          render={({ pageNumber, totalPages }) =>
            `Confidential  ·  Rose Finance Academy  ·  Page ${pageNumber} of ${totalPages}`
          }
          fixed
        />
      </Page>

      {/* ── Page 2: Strengths/Barriers + Accounts table + Coach Notes + Disclaimer ── */}
      <Page size="A4" style={s.page}>
        <Header data={data} />
        <StrengthsBarriers data={data} />
        <FundingOptionsNotes data={data} />
        <BusinessContext data={data} />
        <AccountsTable data={data} />
        {coachNotes ? <CoachNotes notes={coachNotes} /> : null}
        <Disclaimer clientName={data.applicant.clientName} />

        <Text
          style={s.footer}
          render={({ pageNumber, totalPages }) =>
            `Confidential  ·  Rose Finance Academy  ·  Page ${pageNumber} of ${totalPages}`
          }
          fixed
        />
      </Page>
    </Document>
  );
}

// ---------------------------------------------------------------------------
// Export — called from routes.ts
// ---------------------------------------------------------------------------

export async function generateAssessmentPdf(
  data: CreditReportData,
  coachNotes: string | null,
  res: Response
) {
  const filename = `${data.applicant.clientName.replace(/\s+/g, "_")}_Funding_Readiness_Assessment.pdf`;
  res.setHeader("Content-disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-type", "application/pdf");

  const stream = await renderToStream(<AssessmentDocument data={data} coachNotes={coachNotes} />);
  stream.pipe(res);
}
