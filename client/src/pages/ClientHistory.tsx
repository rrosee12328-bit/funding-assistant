import { useClientReports } from "@/hooks/use-reports";
import { useParams, Link } from "wouter";
import { format } from "date-fns";
import { ArrowLeft, ArrowRight, CheckCircle2, AlertTriangle, XCircle, HelpCircle, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { CreditReportData, CategoryResult, ReadinessStatus } from "@shared/schema";

// ── helpers ────────────────────────────────────────────────────────────────

function statusColor(status: ReadinessStatus) {
  switch (status) {
    case "PASS":    return "text-emerald-400";
    case "CAUTION": return "text-yellow-400";
    case "FAIL":    return "text-red-400";
    default:        return "text-slate-400";
  }
}

function StatusIcon({ status }: { status: ReadinessStatus }) {
  switch (status) {
    case "PASS":    return <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />;
    case "CAUTION": return <AlertTriangle className="w-4 h-4 text-yellow-400 shrink-0" />;
    case "FAIL":    return <XCircle className="w-4 h-4 text-red-400 shrink-0" />;
    default:        return <HelpCircle className="w-4 h-4 text-slate-400 shrink-0" />;
  }
}

function overallBadgeVariant(status: string) {
  if (status === "Funding Ready") return "default";
  if (status === "Nearly Funding Ready") return "secondary";
  return "destructive";
}

function overallBadgeClass(status: string) {
  if (status === "Funding Ready")
    return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20";
  if (status === "Nearly Funding Ready")
    return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30 hover:bg-yellow-500/20";
  return "bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/20";
}

// All category keys in display order
const ALL_CATEGORIES = [
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
] as const;

// ── component ──────────────────────────────────────────────────────────────

export default function ClientHistory() {
  const { name } = useParams<{ name: string }>();
  // wouter already URL-decodes path params — do not decode again
  const clientName = (name ?? "").trim();
  const { data: reports, isLoading } = useClientReports(clientName);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!reports || reports.length === 0) {
    return (
      <div className="space-y-6 animate-in">
        <div className="flex items-center gap-3">
          <Link href="/">
            <Button variant="ghost" size="icon"><ArrowLeft className="w-4 h-4" /></Button>
          </Link>
          <h1 className="text-3xl font-display font-bold">{clientName}</h1>
        </div>
        <p className="text-muted-foreground">No reports found for this client.</p>
      </div>
    );
  }

  // Only finalized reports carry readiness data worth comparing
  const finalized = reports.filter(r => r.isFinalized);
  const allData = reports.map(r => ({
    report: r,
    data: r.reportData as unknown as CreditReportData,
  }));

  return (
    <div className="space-y-8 animate-in">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/">
          <Button variant="ghost" size="icon" className="shrink-0">
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">{clientName}</h1>
          <p className="text-muted-foreground mt-1">
            {reports.length} report{reports.length !== 1 ? "s" : ""} · {finalized.length} finalized
          </p>
        </div>
      </div>

      {/* Timeline */}
      <div>
        <h2 className="text-lg font-display font-semibold mb-4">Report Timeline</h2>
        <div className="flex flex-col gap-3">
          {allData.map(({ report, data }, idx) => (
            <div
              key={report.id}
              className="flex items-center gap-4 p-4 rounded-xl bg-white/5 border border-white/5"
            >
              <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-primary text-sm font-bold shrink-0">
                {idx + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">
                    {format(new Date(report.createdAt), "MMM d, yyyy")}
                  </span>
                  {report.isFinalized && data?.readiness?.overallStatus ? (
                    <Badge
                      variant="outline"
                      className={overallBadgeClass(data.readiness.overallStatus)}
                    >
                      {data.readiness.overallStatus}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="border-white/10 text-muted-foreground">
                      Not finalized
                    </Badge>
                  )}
                </div>
                {data?.applicant && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Report date: {data.applicant.reportDate}
                    {data.applicant.experianScore != null && ` · Experian ${data.applicant.experianScore}`}
                    {data.applicant.equifaxScore != null && ` · Equifax ${data.applicant.equifaxScore}`}
                    {data.applicant.transunionScore != null && ` · TU ${data.applicant.transunionScore}`}
                  </p>
                )}
              </div>
              <Link href={`/report/${report.id}`}>
                <Button size="icon" variant="ghost">
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </Link>
            </div>
          ))}
        </div>
      </div>

      {/* Progress comparison — only when 2+ finalized reports exist */}
      {finalized.length >= 2 && (
        <Card className="glass-card p-6">
          <h2 className="text-lg font-display font-semibold mb-2">Progress Comparison</h2>
          <p className="text-xs text-muted-foreground mb-6">
            Comparing finalized assessments oldest → newest
          </p>

          {/* Overall status row */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-muted-foreground mb-3 uppercase tracking-wide">
              Overall Status
            </h3>
            <div className="grid gap-2" style={{ gridTemplateColumns: `180px repeat(${finalized.length}, 1fr)` }}>
              <div className="text-sm text-muted-foreground py-2">Assessment</div>
              {finalized.map((r, i) => {
                const d = r.reportData as unknown as CreditReportData;
                return (
                  <div key={r.id} className="py-2">
                    <div className="text-xs text-muted-foreground mb-1">
                      {format(new Date(r.createdAt), "MMM d, yyyy")}
                      {i === 0 && <span className="ml-1 text-primary">(oldest)</span>}
                      {i === finalized.length - 1 && finalized.length > 1 && (
                        <span className="ml-1 text-primary">(latest)</span>
                      )}
                    </div>
                    <Badge
                      variant="outline"
                      className={overallBadgeClass(d?.readiness?.overallStatus ?? "")}
                    >
                      {d?.readiness?.overallStatus ?? "—"}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Category-by-category comparison */}
          <h3 className="text-sm font-medium text-muted-foreground mb-3 uppercase tracking-wide">
            Category Breakdown
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10">
                  <th className="text-left py-2 pr-4 font-medium text-muted-foreground w-48">
                    Category
                  </th>
                  {finalized.map((r, i) => (
                    <th key={r.id} className="text-center py-2 px-2 font-medium text-muted-foreground min-w-[120px]">
                      {format(new Date(r.createdAt), "MMM d, yyyy")}
                      {i === 0 && <div className="text-xs text-primary font-normal">oldest</div>}
                      {i === finalized.length - 1 && finalized.length > 1 && (
                        <div className="text-xs text-primary font-normal">latest</div>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ALL_CATEGORIES.map(category => {
                  const cells = finalized.map(r => {
                    const d = r.reportData as unknown as CreditReportData;
                    return d?.readiness?.categories?.find(
                      (c: CategoryResult) => c.category === category
                    ) ?? null;
                  });

                  return (
                    <tr key={category} className="border-b border-white/5 hover:bg-white/3 transition-colors">
                      <td className="py-3 pr-4 text-foreground font-medium">{category}</td>
                      {cells.map((cell, i) => (
                        <td key={i} className="py-3 px-2 text-center">
                          {cell ? (
                            <div className="flex flex-col items-center gap-1">
                              <div className="flex items-center gap-1 justify-center">
                                <StatusIcon status={cell.status} />
                                <span className={`text-xs font-medium ${statusColor(cell.status)}`}>
                                  {cell.status}
                                </span>
                              </div>
                              <span className="text-xs text-muted-foreground leading-tight text-center max-w-[130px]">
                                {cell.detail}
                              </span>
                            </div>
                          ) : (
                            <span className="text-muted-foreground text-xs">—</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {finalized.length === 1 && (
        <Card className="glass-card p-6">
          <p className="text-muted-foreground text-sm">
            Progress comparison will appear here once a second finalized report exists for this client.
          </p>
        </Card>
      )}

      {finalized.length === 0 && (
        <Card className="glass-card p-6">
          <p className="text-muted-foreground text-sm">
            No finalized reports yet. Finalize a report to see the funding-readiness assessment.
          </p>
        </Card>
      )}
    </div>
  );
}
