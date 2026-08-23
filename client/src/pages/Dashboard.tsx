import { useReports } from "@/hooks/use-reports";
import { StatCard } from "@/components/StatCard";
import { Users, FileText, ShieldCheck, TrendingUp, ArrowRight, Loader2, Clock } from "lucide-react";
import { format } from "date-fns";
import { Link } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { CreditReportData } from "@shared/schema";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell
} from "recharts";

// Stable display order for overall status badges
function overallBadgeClass(status: string) {
  if (status === "Funding Ready")
    return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/20";
  if (status === "Nearly Funding Ready")
    return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30 hover:bg-yellow-500/20";
  return "bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/20";
}

export default function Dashboard() {
  const { data: reports, isLoading } = useReports();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // ── analytics ────────────────────────────────────────────────────────────
  const totalReports = reports?.length || 0;
  const fundingReadyCount = reports?.filter(r => {
    if (!r.isFinalized) return false;
    const data = r.reportData as unknown as CreditReportData;
    return data?.readiness?.overallStatus === "Funding Ready";
  }).length || 0;

  // Group all reports by client name (case-insensitive key, display name from first entry)
  const clientMap = new Map<string, {
    displayName: string;
    reports: typeof reports extends undefined ? never[] : NonNullable<typeof reports>;
  }>();

  reports?.forEach(r => {
    const trimmed = r.clientName.trim();
    const key = trimmed.toLowerCase();
    if (!clientMap.has(key)) {
      clientMap.set(key, { displayName: trimmed, reports: [] as any });
    }
    clientMap.get(key)!.reports.push(r as any);
  });

  const clients = Array.from(clientMap.values())
    .map(c => ({
      ...c,
      // Guarantee ascending createdAt order regardless of getReports() result order
      reports: [...c.reports].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      ),
    }))
    .sort((a, b) => {
      // sort clients by most recent report date descending
      const aLatest = new Date(a.reports[a.reports.length - 1].createdAt).getTime();
      const bLatest = new Date(b.reports[b.reports.length - 1].createdAt).getTime();
      return bLatest - aLatest;
    });

  // Chart data — collections + charge-offs per client (latest report per client)
  const chartData = clients.slice(0, 7).map(({ displayName, reports: cReports }) => {
    const latest = cReports[cReports.length - 1]; // safe: sorted ascending above
    const data = latest.reportData as unknown as CreditReportData;
    return {
      name: displayName.split(" ")[0],
      items: (data?.accountSummary?.collections || 0) + (data?.accountSummary?.chargeOffs || 0),
    };
  });

  return (
    <div className="space-y-8 animate-in">
      <div className="flex justify-between items-end">
        <div>
          <h1 className="text-4xl font-display font-bold text-foreground">Welcome Back, Coach</h1>
          <p className="text-muted-foreground mt-2">Here's what's happening with your client reports today.</p>
        </div>
        <Link href="/new">
          <Button className="bg-primary text-white hover:bg-pink-500 font-medium px-6 rounded-xl brand-glow transition-all duration-200 hover:scale-[1.02]">
            <TrendingUp className="w-4 h-4 mr-2" />
            Analyze New Report
          </Button>
        </Link>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard
          title="Total Reports Processed"
          value={totalReports}
          icon={FileText}
          trend="+12% this month"
          trendUp={true}
        />
        <StatCard
          title="Funding Ready Clients"
          value={fundingReadyCount}
          icon={ShieldCheck}
          className="from-pink-500/5 to-transparent bg-gradient-to-br"
        />
        <StatCard
          title="Active Clients"
          value={clients.length}
          icon={Users}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Chart */}
        <Card className="glass-card p-6">
          <h3 className="font-display font-bold text-xl mb-6">Collections & Charge-Offs by Client</h3>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <XAxis dataKey="name" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip
                  cursor={{ fill: "rgba(255,255,255,0.05)" }}
                  contentStyle={{ backgroundColor: "#1e293b", border: "1px solid rgba(255,255,255,0.1)", borderRadius: "8px" }}
                />
                <Bar dataKey="items" radius={[4, 4, 0, 0]}>
                  {chartData.map((_, index) => (
                    <Cell key={`cell-${index}`} fill="hsl(var(--primary))" />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Client list grouped */}
        <Card className="glass-card p-6">
          <div className="flex justify-between items-center mb-6">
            <h3 className="font-display font-bold text-xl">Clients</h3>
            <span className="text-xs text-muted-foreground">{clients.length} total</span>
          </div>

          <div className="space-y-3 overflow-y-auto max-h-[340px] pr-1">
            {clients.map(({ displayName, reports: cReports }) => {
              const latest = cReports[cReports.length - 1];
              const latestData = latest.reportData as unknown as CreditReportData;
              const latestStatus = latest.isFinalized
                ? latestData?.readiness?.overallStatus
                : null;
              const hasMultiple = cReports.length > 1;

              return (
                <Link
                  key={displayName.toLowerCase()}
                  href={`/clients/${encodeURIComponent(displayName)}`}
                >
                  <div className="group flex items-center justify-between p-4 rounded-xl bg-white/5 border border-white/5 hover:bg-white/10 transition-colors cursor-pointer">
                    <div className="flex items-center gap-4 min-w-0">
                      <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold shrink-0">
                        {displayName.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-medium text-foreground">{displayName}</h4>
                          {latestStatus && (
                            <Badge
                              variant="outline"
                              className={`text-xs ${overallBadgeClass(latestStatus)}`}
                            >
                              {latestStatus}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                          {hasMultiple ? (
                            <>
                              <Clock className="w-3 h-3" />
                              {cReports.length} reports · latest {format(new Date(latest.createdAt), "MMM d, yyyy")}
                            </>
                          ) : (
                            <>Processed {format(new Date(latest.createdAt), "MMM d, yyyy")}</>
                          )}
                        </p>
                      </div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                  </div>
                </Link>
              );
            })}
            {clients.length === 0 && (
              <div className="text-center py-8 text-muted-foreground">
                No reports processed yet.
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
