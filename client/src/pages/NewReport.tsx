import { useState } from "react";
import { useForm } from "react-hook-form";
import { useProcessReport } from "@/hooks/use-reports";
import { zodResolver } from "@hookform/resolvers/zod";
import { processReportSchema, type ProcessReportRequest } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Loader2, UploadCloud, FileText, CheckCircle, AlertTriangle } from "lucide-react";
import { useDropzone } from "react-dropzone";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";

interface DebugInfo {
  filename: string;
  fileSize: number;
  mimeType: string;
  headerOk: boolean;
  parsersUsed: string[];
  errors: string[];
  charCount: number;
  pagesRead?: number;
}

export default function NewReport() {
  const [, setLocation] = useLocation();
  const { mutate: processReport, isPending } = useProcessReport();
  const [file, setFile] = useState<File | null>(null);
  const [debugInfo, setDebugInfo] = useState<DebugInfo | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const form = useForm<ProcessReportRequest>({
    resolver: zodResolver(processReportSchema),
    defaultValues: {
      consentConfirmed: false,
    }
  });

  const onDrop = (acceptedFiles: File[]) => {
    if (acceptedFiles.length > 0) {
      setFile(acceptedFiles[0]);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] },
    maxFiles: 1,
  });

  const onSubmit = (data: ProcessReportRequest) => {
    if (!file) return;

    setDebugInfo(null);
    setLastError(null);

    const formData = new FormData();
    formData.append("file", file);
    formData.append("clientName", data.clientName);
    formData.append("reportDate", data.reportDate);
    formData.append("consentConfirmed", String(data.consentConfirmed));
    if (data.coachNotes) {
      formData.append("coachNotes", data.coachNotes);
    }
    if (data.businessAgeInput) {
      formData.append("businessAgeInput", data.businessAgeInput);
    }
    if (data.clientRequests) {
      formData.append("clientRequests", data.clientRequests);
    }
    if (data.businessInformation) {
      formData.append("businessInformation", data.businessInformation);
    }

    console.log("[Frontend] Submitting form with file:", file.name, file.type, file.size);

    processReport(formData, {
      onSuccess: (data) => {
        setLocation(`/review/${data.id}`);
      },
      onError: (error: any) => {
        setLastError(error.message || "Processing failed");
        if (error.debug) {
          setDebugInfo(error.debug);
          console.log("[Frontend] Debug info:", error.debug);
        }
      }
    });
  };

  return (
    <div className="max-w-3xl mx-auto space-y-8 animate-in pb-20">
      <div>
        <h1 className="text-4xl font-display font-bold text-foreground">New Funding Readiness Assessment</h1>
        <p className="text-muted-foreground mt-2">Upload a credit report PDF to generate a business funding readiness assessment.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="md:col-span-2 space-y-6">
          <Card className="glass-card p-8">
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="clientName">Client Name</Label>
                <Input
                  id="clientName"
                  {...form.register("clientName")}
                  placeholder="e.g. Jane Doe"
                  className="bg-background/50 border-white/10 focus:border-primary"
                />
                {form.formState.errors.clientName && (
                  <p className="text-sm text-destructive">{form.formState.errors.clientName.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="reportDate">Report Date</Label>
                <Input
                  id="reportDate"
                  type="date"
                  {...form.register("reportDate")}
                  className="bg-background/50 border-white/10 focus:border-primary"
                />
                {form.formState.errors.reportDate && (
                  <p className="text-sm text-destructive">{form.formState.errors.reportDate.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="businessAgeInput">Business Age</Label>
                <Input
                  id="businessAgeInput"
                  {...form.register("businessAgeInput")}
                  placeholder="e.g. 18 months, 2 years, or a start date"
                  className="bg-background/50 border-white/10 focus:border-primary"
                />
                <p className="text-xs text-muted-foreground">
                  Used for the Business Age qualification check. Leave blank if unknown.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="coachNotes">Coach Notes (Optional)</Label>
                <Textarea
                  id="coachNotes"
                  {...form.register("coachNotes")}
                  placeholder="Any specific context about this client..."
                  className="bg-background/50 border-white/10 focus:border-primary h-32"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="clientRequests">Client Requests (Optional)</Label>
                <Textarea
                  id="clientRequests"
                  {...form.register("clientRequests")}
                  placeholder="What funding amount, timeline, product type, or outcome is the client asking for?"
                  className="bg-background/50 border-white/10 focus:border-primary h-28"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="businessInformation">Business Information (Optional)</Label>
                <Textarea
                  id="businessInformation"
                  {...form.register("businessInformation")}
                  placeholder="Business type, revenue, industry, entity status, bank statements, or other context for underwriting."
                  className="bg-background/50 border-white/10 focus:border-primary h-28"
                />
              </div>

              <div className="space-y-2">
                <Label>Credit Report PDF</Label>
                <div
                  {...getRootProps()}
                  className={cn(
                    "border-2 border-dashed rounded-xl p-8 transition-colors cursor-pointer flex flex-col items-center justify-center text-center",
                    isDragActive ? "border-pink-400 bg-pink-500/5 brand-glow" : "border-white/10 hover:border-pink-400/50 hover:bg-white/5",
                    file ? "border-green-500/50 bg-green-500/5" : ""
                  )}
                >
                  <input {...getInputProps()} />
                  {file ? (
                    <>
                      <FileText className="w-10 h-10 text-green-500 mb-2" />
                      <p className="font-medium text-green-500">{file.name}</p>
                      <p className="text-xs text-muted-foreground mt-1">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                    </>
                  ) : (
                    <>
                      <UploadCloud className="w-10 h-10 text-muted-foreground mb-2" />
                      <p className="font-medium text-muted-foreground">Drag & drop or click to upload</p>
                      <p className="text-xs text-muted-foreground mt-1">PDF files only (Max 10MB)</p>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-start gap-3 p-4 rounded-lg bg-primary/5 border border-primary/10">
                <Checkbox
                  id="consent"
                  checked={form.watch("consentConfirmed")}
                  onCheckedChange={(c) => form.setValue("consentConfirmed", c === true)}
                />
                <div className="grid gap-1.5 leading-none">
                  <Label htmlFor="consent" className="font-medium cursor-pointer">
                    Confirm Client Consent
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    I confirm that I have obtained necessary permission from the client to process their credit data for coaching purposes.
                  </p>
                </div>
              </div>
              {form.formState.errors.consentConfirmed && (
                <p className="text-sm text-destructive">{form.formState.errors.consentConfirmed.message}</p>
              )}

              <Button
                type="submit"
                disabled={isPending || !file}
                className="w-full bg-primary text-white hover:bg-pink-500 py-6 text-lg rounded-xl brand-glow transition-all duration-200 hover:scale-[1.01] disabled:opacity-50"
              >
                {isPending ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Extracting Report Data...
                  </>
                ) : (
                  "Extract & Review Report"
                )}
              </Button>
            </form>

            {lastError && (
              <div className="mt-6 space-y-4">
                <Alert className="border-destructive/50 bg-destructive/5">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  <AlertDescription className="text-destructive">
                    {lastError}
                  </AlertDescription>
                </Alert>
                {debugInfo && (
                  <Card className="p-4 bg-background/50 border-white/10">
                    <div className="text-sm space-y-2 font-mono text-muted-foreground">
                      <div><strong>Debug Info:</strong></div>
                      <div>📄 File: {debugInfo.filename}</div>
                      <div>📊 Size: {(debugInfo.fileSize / 1024 / 1024).toFixed(2)} MB</div>
                      <div>🏷️ MIME: {debugInfo.mimeType}</div>
                      <div>✅ PDF Header (%PDF): {debugInfo.headerOk ? "Yes" : "No"}</div>
                      <div>📝 Extracted Chars: {debugInfo.charCount}</div>
                      {debugInfo.pagesRead && <div>📄 Pages Read: {debugInfo.pagesRead}</div>}
                      {debugInfo.parsersUsed.length > 0 && (
                        <div>✓ Parsers Used: {debugInfo.parsersUsed.join(", ")}</div>
                      )}
                      {debugInfo.errors.length > 0 && (
                        <div>⚠️ Errors: {debugInfo.errors.join("; ")}</div>
                      )}
                    </div>
                  </Card>
                )}
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="glass-card p-6 bg-gradient-to-br from-primary/10 to-transparent border-primary/20">
            <h3 className="font-display font-bold text-lg mb-4 flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-primary" />
              What to Expect
            </h3>
            <ul className="space-y-4 text-sm text-muted-foreground">
              <li className="flex gap-3">
                <span className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-primary text-xs font-bold shrink-0">1</span>
                AI extracts every account and bureau score from the PDF.
              </li>
              <li className="flex gap-3">
                <span className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-primary text-xs font-bold shrink-0">2</span>
                You review and correct the extracted data before scoring.
              </li>
              <li className="flex gap-3">
                <span className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-primary text-xs font-bold shrink-0">3</span>
                A rule-based engine checks 10 funding qualification standards.
              </li>
              <li className="flex gap-3">
                <span className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-primary text-xs font-bold shrink-0">4</span>
                Creates a professional funding readiness PDF for your client.
              </li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
