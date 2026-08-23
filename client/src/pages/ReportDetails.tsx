import { useReport, useDownloadPdf } from "@/hooks/use-reports";
import { useParams, Link } from "wouter";
import { Loader2, Download, ArrowLeft, AlertCircle, CheckCircle2, ChevronDown, ChevronUp, Pencil } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { CreditReportData, CategoryResult, ReadinessStatus } from "@shared/schema";
import { useState } from "react";
import { cn } from "@/lib/utils";

export default function ReportDetails() {
  const { id } = useParams();
  const reportId = Number(id);
  const { data: report, isLoading } = useReport(reportId);
  const { mutate: downloadPdf, isPending: isDownloading } = useDownloadPdf(reportId, report?.clientName || "Client");
  const [showRawText, setShowRawText] = useState(false);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!report) {
    return (
      <div className="flex flex-col h-screen items-center justify-center gap-4">
        <h2 className="text-2xl font-bold">Report Not Found</h2>
        <Link href="/">
          <Button variant="outline">Return Dashboard</Button>
        </Link>
      </div>
    );
  }

  if (!report.isFinalized) {
    return (
      <div className="flex flex-col h-screen items-center justify-center gap-4">
        <h2 className="text-2xl font-bold">This Report Hasn't Been Reviewed Yet</h2>
        <p className="text-muted-foreground max-w-md text-center">
          The assessment is generated only after the extracted data has been reviewed and confirmed.
        </p>
        <Link href={`/review/${reportId}`}>
          <Button className="bg-primary text-white hover:bg-pink-500">Go to Review Screen</Button>
        </Link>
      </div>
    );
  }

  const data = report.reportData as unknown as CreditReportData;
  const fundingOptionsNotes = data.readiness.fundingOptionsNotes ?? [];
  const clientRequests = data.business.clientRequests ?? null;
  const businessInformation = data.business.businessInformation ?? null;
  const formatAccountNumber = (value: string | null | undefined) => {
    const trimmed = (value || "").trim();
    return trimmed && !/^n\/?a$/i.test(trimmed) ? trimmed : "N/A";
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8 animate-in pb-20">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <Link href="/">
            <div className="flex items-center text-sm text-muted-foreground hover:text-primary transition-colors cursor-pointer mb-2">
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back to Dashboard
            </div>
          </Link>
          <h1 className="text-4xl font-display font-bold text-foreground">{data.applicant.clientName}</h1>
          <p className="text-muted-foreground">Report Date: {data.applicant.reportDate}</p>
        </div>
        <div className="flex gap-2">
          <Link href={`/review/${reportId}`}>
            <Button variant="outline">
              <Pencil className="w-4 h-4 mr-2" />
              Edit Data
            </Button>
          </Link>
          <Button
            onClick={() => downloadPdf()}
            disabled={isDownloading}
            className="bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/20"
          >
            {isDownloading ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Download className="w-4 h-4 mr-2" />
            )}
            Download Client PDF
          </Button>
        </div>
      </div>

      {/* Overall Status */}
      <Card className={cn("glass-card p-8 border-2", overallStatusBorder(data.readiness.overallStatus))}>
        <span className="text-xs uppercase tracking-wider text-muted-foreground">Overall Status</span>
        <h2 className={cn("text-3xl font-display font-bold mt-1", overallStatusText(data.readiness.overallStatus))}>
          {data.readiness.overallStatus}
        </h2>
        <div className="grid grid-cols-3 gap-4 mt-6">
          <StatBox label="Experian" value={data.applicant.experianScore ?? "N/A"} />
          <StatBox label="Equifax" value={data.applicant.equifaxScore ?? "N/A"} />
          <StatBox label="TransUnion" value={data.applicant.transunionScore ?? "N/A"} />
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main Content */}
        <div className="lg:col-span-2 space-y-8">
          {/* Qualification Checklist */}
          <Card className="glass-card p-8">
            <h2 className="font-display font-bold text-2xl mb-6 flex items-center gap-3">
              <CheckCircle2 className="w-6 h-6 text-primary" />
              Qualification Checklist
            </h2>
            <div className="space-y-3">
              {data.readiness.categories.map((cat) => (
                <CategoryRow key={cat.category} category={cat} />
              ))}
            </div>
          </Card>

          {/* Strengths / Barriers */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="glass-card p-6 border-green-500/20">
              <h3 className="font-bold text-lg mb-4 text-green-500">Strengths</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                {data.readiness.strengths.length === 0 && <li>None identified yet.</li>}
                {data.readiness.strengths.map((s, i) => (
                  <li key={i} className="flex gap-2"><span className="text-green-500 shrink-0">•</span>{s}</li>
                ))}
              </ul>
            </Card>
            <Card className="glass-card p-6 border-amber-500/20">
              <h3 className="font-bold text-lg mb-4 text-amber-500">Barriers to Address</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                {data.readiness.barriers.length === 0 && <li>No barriers identified.</li>}
                {data.readiness.barriers.map((b, i) => (
                  <li key={i} className="flex gap-2"><span className="text-amber-500 shrink-0">•</span>{b}</li>
                ))}
              </ul>
            </Card>
          </div>

          {/* Funding Options Notes */}
          {fundingOptionsNotes.length > 0 && (
            <Card className="glass-card p-6 border-primary/20">
              <h3 className="font-bold text-lg mb-4 text-primary">Funding Options Notes</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                {fundingOptionsNotes.map((note, i) => (
                  <li key={i} className="flex gap-2"><span className="text-primary shrink-0">•</span>{note}</li>
                ))}
              </ul>
            </Card>
          )}

          {/* All Accounts */}
          <Card className="glass-card p-8">
            <h2 className="font-display font-bold text-2xl mb-6">All Accounts</h2>
            <div className="overflow-x-auto rounded-xl border border-white/10">
              <table className="w-full text-sm">
                <thead className="bg-white/5">
                  <tr>
                    <th className="p-4 text-left font-medium text-muted-foreground">Account</th>
                    <th className="p-4 text-left font-medium text-muted-foreground">Account #</th>
                    <th className="p-4 text-left font-medium text-muted-foreground">Type</th>
                    <th className="p-4 text-left font-medium text-muted-foreground">Status</th>
                    <th className="p-4 text-left font-medium text-muted-foreground">Balance</th>
                    <th className="p-4 text-left font-medium text-muted-foreground">Limit</th>
                    <th className="p-4 text-left font-medium text-muted-foreground">Utilization</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {data.accounts.map((acc) => {
                    const isRevolving = acc.accountType === "Revolving Credit Card" || acc.accountType === "Charge Card";
                    const utilization =
                      isRevolving && acc.currentBalance !== null && acc.creditLimitOrOriginalAmount
                        ? `${Math.round((acc.currentBalance / acc.creditLimitOrOriginalAmount) * 1000) / 10}%`
                        : "N/A";
                    return (
                      <tr key={acc.id} className="hover:bg-white/5 transition-colors">
                        <td className="p-4 font-medium">{acc.creditorName}</td>
                        <td className="p-4 font-mono text-muted-foreground whitespace-nowrap">{formatAccountNumber(acc.accountNumberMasked)}</td>
                        <td className="p-4 text-muted-foreground">{acc.accountType}</td>
                        <td className="p-4 text-muted-foreground">{acc.accountStatus}</td>
                        <td className="p-4">{acc.currentBalance !== null ? `$${acc.currentBalance.toLocaleString()}` : "N/A"}</td>
                        <td className="p-4">{acc.creditLimitOrOriginalAmount !== null ? `$${acc.creditLimitOrOriginalAmount.toLocaleString()}` : "N/A"}</td>
                        <td className="p-4">{utilization}</td>
                      </tr>
                    );
                  })}
                  {data.accounts.length === 0 && (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-muted-foreground">No accounts found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        {/* Sidebar Info */}
        <div className="space-y-6">
          <Card className="glass-card p-6">
            <h3 className="font-bold text-lg mb-4">Debt Summary</h3>
            <div className="space-y-3 text-sm">
              <SummaryRow label="Total Reported Debt" value={money(data.debtSummary.totalReportedDebt)} />
              <SummaryRow label="Revolving Debt" value={money(data.debtSummary.totalRevolvingDebt)} />
              <SummaryRow label="Revolving Limits" value={money(data.debtSummary.totalRevolvingLimits)} />
              <SummaryRow
                label="Revolving Utilization"
                value={data.debtSummary.overallRevolvingUtilization !== null ? `${Math.round(data.debtSummary.overallRevolvingUtilization * 10) / 10}%` : "N/A"}
              />
              <Separator className="bg-white/10" />
              <SummaryRow label="Installment Debt" value={money(data.debtSummary.totalInstallmentDebt)} />
              <SummaryRow label="Mortgage Debt" value={money(data.debtSummary.totalMortgageDebt)} />
              <SummaryRow label="Auto Loan Debt" value={money(data.debtSummary.totalAutoLoanDebt)} />
              <SummaryRow label="Student Loan Debt" value={money(data.debtSummary.totalStudentLoanDebt)} />
              <Separator className="bg-white/10" />
              <SummaryRow label="Collection Balances" value={money(data.debtSummary.totalCollectionBalances)} />
              <SummaryRow label="Charge-Off Balances" value={money(data.debtSummary.totalChargeOffBalances)} />
              <SummaryRow label="Monthly Debt Payments" value={money(data.debtSummary.totalMonthlyDebtPayments)} />
            </div>
          </Card>

          <Card className="glass-card p-6">
            <h3 className="font-bold text-lg mb-4">Account Summary</h3>
            <div className="space-y-3 text-sm">
              <SummaryRow label="Total Accounts" value={String(data.accountSummary.totalUniqueAccounts)} />
              <SummaryRow label="Open" value={String(data.accountSummary.openAccounts)} />
              <SummaryRow label="Closed" value={String(data.accountSummary.closedAccounts)} />
              <SummaryRow label="Revolving" value={String(data.accountSummary.revolvingAccounts)} />
              <SummaryRow label="Collections" value={String(data.accountSummary.collections)} />
              <SummaryRow label="Charge-Offs" value={String(data.accountSummary.chargeOffs)} />
              <SummaryRow label="Bankruptcy Records" value={String(data.accountSummary.bankruptcyRecords)} />
              <Separator className="bg-white/10" />
              <SummaryRow label="Unique Inquiries" value={data.inquiries.estimatedUniqueTotal?.toString() ?? "Unknown"} />
              <SummaryRow label="Business Age" value={data.business.businessAgeMonths !== null ? `${data.business.businessAgeMonths} months` : "Unknown"} />
            </div>
          </Card>

          {(clientRequests || businessInformation) && (
            <Card className="glass-card p-6">
              <h3 className="font-bold text-lg mb-4">Client & Business Context</h3>
              <div className="space-y-4 text-sm">
                {clientRequests && (
                  <div>
                    <div className="font-medium text-foreground mb-1">Client Requests</div>
                    <p className="text-muted-foreground whitespace-pre-wrap leading-relaxed">{clientRequests}</p>
                  </div>
                )}
                {businessInformation && (
                  <div>
                    <div className="font-medium text-foreground mb-1">Business Information</div>
                    <p className="text-muted-foreground whitespace-pre-wrap leading-relaxed">{businessInformation}</p>
                  </div>
                )}
              </div>
            </Card>
          )}

          <Card className="glass-card p-6">
            <h3 className="font-bold text-lg mb-4 flex items-center gap-2">
              <AlertCircle className="w-5 h-5 text-primary" />
              Raw Extracted Text
            </h3>
            <div className="border rounded-lg border-white/10 overflow-hidden">
              <button
                onClick={() => setShowRawText(!showRawText)}
                className="w-full flex items-center justify-between p-3 bg-white/5 text-sm font-medium hover:bg-white/10 transition-colors"
                data-testid="button-toggle-raw-text"
              >
                View Extracted Text
                {showRawText ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              {showRawText && (
                <ScrollArea className="h-64 p-3 text-xs font-mono text-muted-foreground bg-black/20">
                  {report.extractedText.slice(0, 5000)}...
                </ScrollArea>
              )}
            </div>
          </Card>
        </div>
      </div>

      {report.coachNotes && (
        <Card className="glass-card p-6 border-primary/20">
          <h3 className="font-bold text-lg mb-3 flex items-center gap-2">
            <Pencil className="w-5 h-5 text-primary" />
            Coach Notes
          </h3>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">{report.coachNotes}</p>
        </Card>
      )}

      <p className="text-xs text-muted-foreground text-center max-w-2xl mx-auto">
        This assessment reflects general funding-readiness qualification standards used across common small-business
        lenders and is not a guarantee of approval by any specific bank or lender.
      </p>
    </div>
  );
}

function money(n: number): string {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function overallStatusText(status: string): string {
  if (status === "Funding Ready") return "text-green-500";
  if (status === "Nearly Funding Ready") return "text-amber-500";
  return "text-red-500";
}

function overallStatusBorder(status: string): string {
  if (status === "Funding Ready") return "border-green-500/30";
  if (status === "Nearly Funding Ready") return "border-amber-500/30";
  return "border-red-500/30";
}

function StatBox({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="bg-white/5 rounded-xl p-4 text-center border border-white/5">
      <div className="text-2xl font-bold font-display text-primary">{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{label}</div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

const STATUS_STYLES: Record<ReadinessStatus, string> = {
  PASS: "bg-green-500/15 text-green-400 border-green-500/30",
  CAUTION: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  FAIL: "bg-red-500/15 text-red-400 border-red-500/30",
  UNKNOWN: "bg-slate-500/15 text-slate-400 border-slate-500/30",
};

function CategoryRow({ category }: { category: CategoryResult }) {
  return (
    <div className="flex items-start gap-4 p-4 rounded-xl bg-white/5 border border-white/5">
      <span className={cn("px-3 py-1 rounded-full text-xs font-bold border shrink-0 mt-0.5", STATUS_STYLES[category.status])}>
        {category.status}
      </span>
      <div>
        <h4 className="font-medium text-foreground">{category.category}</h4>
        <p className="text-sm text-muted-foreground mt-0.5">{category.detail}</p>
      </div>
    </div>
  );
}
