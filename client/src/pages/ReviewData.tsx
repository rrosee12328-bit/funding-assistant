import { useEffect, useState } from "react";
import { useParams, useLocation, Link } from "wouter";
import { useReport, useFinalizeReport, useReextractReport } from "@/hooks/use-reports";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, ArrowLeft, Plus, Trash2, AlertTriangle, RefreshCw } from "lucide-react";
import type { CreditAccount, CreditReportData, AccountType } from "@shared/schema";
import { accountTypeEnum } from "@shared/schema";

const ACCOUNT_TYPES = accountTypeEnum.options;

function emptyAccount(): CreditAccount {
  return {
    id: crypto.randomUUID(),
    creditorName: "",
    accountNumberMasked: "",
    accountType: "Other",
    accountStatus: "",
    openClosed: "Unknown",
    dateOpened: null,
    accountAgeMonths: null,
    currentBalance: null,
    creditLimitOrOriginalAmount: null,
    monthlyPayment: null,
    pastDueAmount: null,
    paymentStatus: null,
    latePaymentsLast24Months: 0,
    lateHistoryNotes: null,
    bureausReporting: [],
    isDerogatory: false,
    includedInBankruptcy: false,
    confidence: 100,
  };
}

export default function ReviewData() {
  const { id } = useParams();
  const reportId = Number(id);
  const [, setLocation] = useLocation();
  const { data: report, isLoading } = useReport(reportId);
  const { mutate: finalize, isPending: isFinalizing } = useFinalizeReport(reportId);
  const { mutate: reextract, isPending: isReextracting } = useReextractReport(reportId);

  const [experianScore, setExperianScore] = useState<string>("");
  const [equifaxScore, setEquifaxScore] = useState<string>("");
  const [transunionScore, setTransunionScore] = useState<string>("");
  const [businessAgeInput, setBusinessAgeInput] = useState<string>("");
  const [accounts, setAccounts] = useState<CreditAccount[]>([]);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (report && !initialized) {
      const data = report.reportData as unknown as CreditReportData;
      setExperianScore(data.applicant.experianScore?.toString() ?? "");
      setEquifaxScore(data.applicant.equifaxScore?.toString() ?? "");
      setTransunionScore(data.applicant.transunionScore?.toString() ?? "");
      setBusinessAgeInput(data.business.businessAgeInput ?? "");
      setAccounts([...data.accounts, ...data.reviewAccounts]);
      setInitialized(true);
    }
  }, [report, initialized]);

  if (isLoading || !initialized) {
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
          <Button variant="outline">Return to Dashboard</Button>
        </Link>
      </div>
    );
  }

  const data = report.reportData as unknown as CreditReportData;
  const reviewCount = data.reviewAccounts.length;

  const updateAccount = (idx: number, patch: Partial<CreditAccount>) => {
    setAccounts(prev => prev.map((a, i) => (i === idx ? { ...a, ...patch } : a)));
  };

  const removeAccount = (idx: number) => {
    setAccounts(prev => prev.filter((_, i) => i !== idx));
  };

  const addAccount = () => {
    setAccounts(prev => [...prev, emptyAccount()]);
  };

  const onReextract = () => {
    setInitialized(false);
    reextract(undefined, {
      onError: () => {
        // If re-extraction fails, keep showing current data
        setInitialized(true);
      },
    });
  };

  const numOrNull = (v: string): number | null => {
    if (v.trim() === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const onSubmit = () => {
    finalize(
      {
        applicant: {
          clientName: report.clientName,
          reportDate: report.reportDate,
          experianScore: numOrNull(experianScore),
          equifaxScore: numOrNull(equifaxScore),
          transunionScore: numOrNull(transunionScore),
        },
        business: {
          businessAgeInput: businessAgeInput || null,
          businessAgeMonths: null, // recomputed server-side from businessAgeInput
        },
        accounts,
        inquiries: data.inquiries,
      },
      {
        onSuccess: () => setLocation(`/report/${reportId}`),
      }
    );
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8 animate-in pb-24">
      <div>
        <Link href="/">
          <div className="flex items-center text-sm text-muted-foreground hover:text-primary transition-colors cursor-pointer mb-2">
            <ArrowLeft className="w-4 h-4 mr-1" />
            Back to Dashboard
          </div>
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-4xl font-display font-bold text-foreground">Review Extracted Data</h1>
            <p className="text-muted-foreground mt-2">
              Confirm and correct everything below. The final assessment and PDF are generated only from this reviewed data.
            </p>
          </div>
          {!report.isFinalized && (
            <Button
              variant="outline"
              onClick={onReextract}
              disabled={isReextracting}
              className="shrink-0 mt-1"
            >
              {isReextracting ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Re-running…
                </>
              ) : (
                <>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Re-run Extraction
                </>
              )}
            </Button>
          )}
        </div>
      </div>

      {data.extractionWarning && (
        <Card className="glass-card p-4 border-red-500/30 bg-red-500/5 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <p className="text-sm text-muted-foreground">{data.extractionWarning}</p>
        </Card>
      )}

      {reviewCount > 0 && (
        <Card className="glass-card p-4 border-amber-500/30 bg-amber-500/5 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <p className="text-sm text-muted-foreground">
            {reviewCount} account{reviewCount > 1 ? "s were" : " was"} flagged as low-confidence and appended to the
            list below for your review — check each one, correct it, or remove it if it isn't a real account.
          </p>
        </Card>
      )}

      <Card className="glass-card p-8 space-y-6">
        <h2 className="font-display font-bold text-2xl">Applicant Info</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="space-y-2">
            <Label>Experian Score</Label>
            <Input value={experianScore} onChange={e => setExperianScore(e.target.value)} placeholder="e.g. 690" />
          </div>
          <div className="space-y-2">
            <Label>Equifax Score</Label>
            <Input value={equifaxScore} onChange={e => setEquifaxScore(e.target.value)} placeholder="e.g. 690" />
          </div>
          <div className="space-y-2">
            <Label>TransUnion Score</Label>
            <Input value={transunionScore} onChange={e => setTransunionScore(e.target.value)} placeholder="e.g. 690" />
          </div>
          <div className="space-y-2">
            <Label>Business Age</Label>
            <Input value={businessAgeInput} onChange={e => setBusinessAgeInput(e.target.value)} placeholder="e.g. 18 months" />
          </div>
        </div>
      </Card>

      <Card className="glass-card p-8 space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="font-display font-bold text-2xl">All Accounts ({accounts.length})</h2>
          <Button variant="outline" size="sm" onClick={addAccount}>
            <Plus className="w-4 h-4 mr-1" />
            Add Account
          </Button>
        </div>

        <div className="space-y-4">
          {accounts.map((account, idx) => (
            <div key={account.id} className="rounded-xl border border-white/10 p-4 space-y-4 bg-white/5">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  {account.confidence < 60 ? "Flagged for review" : `Row ${idx + 1}`}
                </span>
                <Button variant="ghost" size="icon" onClick={() => removeAccount(idx)}>
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label>Creditor Name</Label>
                  <Input value={account.creditorName} onChange={e => updateAccount(idx, { creditorName: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Account Type</Label>
                  <Select value={account.accountType} onValueChange={(v) => updateAccount(idx, { accountType: v as AccountType })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ACCOUNT_TYPES.map(t => (
                        <SelectItem key={t} value={t}>{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Account # (masked)</Label>
                  <Input value={account.accountNumberMasked} onChange={e => updateAccount(idx, { accountNumberMasked: e.target.value })} />
                </div>

                <div className="space-y-1.5">
                  <Label>Status</Label>
                  <Input value={account.accountStatus} onChange={e => updateAccount(idx, { accountStatus: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Open / Closed</Label>
                  <Select value={account.openClosed} onValueChange={(v) => updateAccount(idx, { openClosed: v as any })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Open">Open</SelectItem>
                      <SelectItem value="Closed">Closed</SelectItem>
                      <SelectItem value="Unknown">Unknown</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Date Opened</Label>
                  <Input
                    value={account.dateOpened ?? ""}
                    onChange={e => updateAccount(idx, { dateOpened: e.target.value || null })}
                    placeholder="YYYY-MM-DD"
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Current Balance</Label>
                  <Input
                    type="number"
                    value={account.currentBalance ?? ""}
                    onChange={e => updateAccount(idx, { currentBalance: numOrNull(e.target.value) })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Credit Limit / Original Amount</Label>
                  <Input
                    type="number"
                    value={account.creditLimitOrOriginalAmount ?? ""}
                    onChange={e => updateAccount(idx, { creditLimitOrOriginalAmount: numOrNull(e.target.value) })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Monthly Payment</Label>
                  <Input
                    type="number"
                    value={account.monthlyPayment ?? ""}
                    onChange={e => updateAccount(idx, { monthlyPayment: numOrNull(e.target.value) })}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label>Past Due Amount</Label>
                  <Input
                    type="number"
                    value={account.pastDueAmount ?? ""}
                    onChange={e => updateAccount(idx, { pastDueAmount: numOrNull(e.target.value) })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Late Payments (last 24mo)</Label>
                  <Input
                    type="number"
                    value={account.latePaymentsLast24Months}
                    onChange={e => updateAccount(idx, { latePaymentsLast24Months: Number(e.target.value) || 0 })}
                  />
                </div>
                <div className="flex flex-col justify-end gap-2">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={account.isDerogatory}
                      onCheckedChange={c => updateAccount(idx, { isDerogatory: c === true })}
                    />
                    Derogatory
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={account.includedInBankruptcy}
                      onCheckedChange={c => updateAccount(idx, { includedInBankruptcy: c === true })}
                    />
                    Included in bankruptcy
                  </label>
                </div>
              </div>
            </div>
          ))}
          {accounts.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">No accounts yet. Add one above if needed.</div>
          )}
        </div>
      </Card>

      <div className="flex justify-end sticky bottom-4">
        <Button
          onClick={onSubmit}
          disabled={isFinalizing}
          className="bg-primary text-white hover:bg-pink-500 py-6 px-8 text-lg rounded-xl brand-glow"
        >
          {isFinalizing ? (
            <>
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Finalizing...
            </>
          ) : (
            "Finalize & Generate Assessment"
          )}
        </Button>
      </div>
    </div>
  );
}
