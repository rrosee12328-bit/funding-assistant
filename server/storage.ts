import { db } from "./db";
import {
  creditReports,
  type InsertCreditReport,
  type CreditReport,
  type StrategySettings,
} from "@shared/schema";
import { eq, asc, sql } from "drizzle-orm";

export interface IStorage {
  getReports(): Promise<CreditReport[]>;
  getReport(id: number): Promise<CreditReport | undefined>;
  getReportsByClientName(clientName: string): Promise<CreditReport[]>;
  createReport(report: InsertCreditReport): Promise<CreditReport>;
  updateReport(id: number, updates: Partial<InsertCreditReport>): Promise<CreditReport | undefined>;

  getSettings(): Promise<StrategySettings>;
  updateSettings(settings: StrategySettings): Promise<StrategySettings>;
}

export class DatabaseStorage implements IStorage {
  private settings: StrategySettings = {
    disputePhilosophy: "Collections and charge-offs come first because they impact utilization and score heavily. Late payments are next priority. Inquiries are lowest priority unless excessive.",
    creditBuildingRecommendations: "Suggest secured cards, Kovo, or Ava credit builders if thin profile.",
    clientEducationMessaging: "Encourage consistency. Remind clients results take multiple rounds (2-3 rounds). Reinforce financial responsibility habits.",
    disputeOrder: "1. Collections\n2. Charge-offs\n3. Late Payments\n4. Inquiries",
  };

  async getReports(): Promise<CreditReport[]> {
    return await db.select().from(creditReports).orderBy(asc(creditReports.createdAt));
  }

  async getReport(id: number): Promise<CreditReport | undefined> {
    const [report] = await db.select().from(creditReports).where(eq(creditReports.id, id));
    return report;
  }

  async getReportsByClientName(clientName: string): Promise<CreditReport[]> {
    // Trim both sides so "Jane Doe" and "Jane Doe " are treated as the same client
    return await db
      .select()
      .from(creditReports)
      .where(sql`trim(${creditReports.clientName}) ilike trim(${clientName})`)
      .orderBy(asc(creditReports.createdAt));
  }

  async createReport(report: InsertCreditReport): Promise<CreditReport> {
    const [created] = await db.insert(creditReports).values(report).returning();
    return created;
  }

  async updateReport(id: number, updates: Partial<InsertCreditReport>): Promise<CreditReport | undefined> {
    const [updated] = await db
      .update(creditReports)
      .set(updates)
      .where(eq(creditReports.id, id))
      .returning();
    return updated;
  }

  async getSettings(): Promise<StrategySettings> {
    return this.settings;
  }

  async updateSettings(settings: StrategySettings): Promise<StrategySettings> {
    this.settings = { ...this.settings, ...settings };
    return this.settings;
  }
}

export const storage = new DatabaseStorage();
