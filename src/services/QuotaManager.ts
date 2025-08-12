export interface QuotaConfig {
  dailyLimit: number;
  monthlyLimit: number;
  payloadSizeLimit: number;
  burstLimit: number;
  burstWindowMs: number;
}

export interface QuotaStats {
  dailyUsage: number;
  monthlyUsage: number;
  dailyRemaining: number;
  monthlyRemaining: number;
  burstUsage: number;
  burstRemaining: number;
  isOverQuota: boolean;
  nextResetTime: number;
}

export interface QuotaResult {
  allowed: boolean;
  reason?: string;
  quotaStats: QuotaStats;
}

export class QuotaManager {
  private config: QuotaConfig;
  private dailyCount: number = 0;
  private monthlyCount: number = 0;
  private totalBytes: number = 0;
  private burstTimestamps: number[] = [];
  private lastResetDate: string;
  private lastResetMonth: string;
  private dailyResetInterval?: NodeJS.Timeout;
  private monthlyResetInterval?: NodeJS.Timeout;

  constructor(config: Partial<QuotaConfig> = {}) {
    this.config = {
      dailyLimit: 1000,
      monthlyLimit: 10000,
      payloadSizeLimit: 512000, // 500KB
      burstLimit: 10,
      burstWindowMs: 60000, // 1 minute
      ...config,
    };

    const now = new Date();
    this.lastResetDate = this.getDateKey(now);
    this.lastResetMonth = this.getMonthKey(now);
    this.loadFromStorage();
    this.scheduleDailyReset();
  }

  canSendError(payloadSize: number = 0): QuotaResult {
    this.cleanupOldData();
    const stats = this.getStats();

    // Check payload size limit
    if (payloadSize > this.config.payloadSizeLimit) {
      return {
        allowed: false,
        reason: `Payload size (${payloadSize}) exceeds limit (${this.config.payloadSizeLimit})`,
        quotaStats: stats,
      };
    }

    // Check burst limit
    this.cleanupBurstTimestamps();
    if (this.burstTimestamps.length >= this.config.burstLimit) {
      return {
        allowed: false,
        reason: 'Burst limit exceeded',
        quotaStats: stats,
      };
    }

    // Check daily limit
    if (this.dailyCount >= this.config.dailyLimit) {
      return {
        allowed: false,
        reason: 'Daily quota exceeded',
        quotaStats: stats,
      };
    }

    // Check monthly limit
    if (this.monthlyCount >= this.config.monthlyLimit) {
      return {
        allowed: false,
        reason: 'Monthly quota exceeded',
        quotaStats: stats,
      };
    }

    return {
      allowed: true,
      quotaStats: stats,
    };
  }

  recordUsage(payloadSize: number = 0): void {
    this.cleanupOldData();
    
    const now = Date.now();
    this.dailyCount++;
    this.monthlyCount++;
    this.totalBytes += payloadSize;
    this.burstTimestamps.push(now);
    
    this.saveToStorage();
  }

  private cleanupOldData(): void {
    const now = new Date();
    const currentDate = this.getDateKey(now);
    const currentMonth = this.getMonthKey(now);

    // Reset daily count if date changed
    if (currentDate !== this.lastResetDate) {
      this.dailyCount = 0;
      this.lastResetDate = currentDate;
    }

    // Reset monthly count if month changed
    if (currentMonth !== this.lastResetMonth) {
      this.monthlyCount = 0;
      this.totalBytes = 0;
      this.lastResetMonth = currentMonth;
    }

    this.cleanupBurstTimestamps();
  }

  private cleanupBurstTimestamps(): void {
    const now = Date.now();
    const cutoff = now - this.config.burstWindowMs;
    this.burstTimestamps = this.burstTimestamps.filter(timestamp => timestamp > cutoff);
  }

  private getDateKey(date: Date): string {
    return date.toISOString().split('T')[0];
  }

  private getMonthKey(date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  }

  getStats(): QuotaStats {
    this.cleanupOldData();
    
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    return {
      dailyUsage: this.dailyCount,
      monthlyUsage: this.monthlyCount,
      dailyRemaining: Math.max(0, this.config.dailyLimit - this.dailyCount),
      monthlyRemaining: Math.max(0, this.config.monthlyLimit - this.monthlyCount),
      burstUsage: this.burstTimestamps.length,
      burstRemaining: Math.max(0, this.config.burstLimit - this.burstTimestamps.length),
      isOverQuota: this.dailyCount >= this.config.dailyLimit || 
                   this.monthlyCount >= this.config.monthlyLimit ||
                   this.burstTimestamps.length >= this.config.burstLimit,
      nextResetTime: tomorrow.getTime(),
    };
  }

  resetQuotas(): void {
    this.dailyCount = 0;
    this.monthlyCount = 0;
    this.totalBytes = 0;
    this.burstTimestamps = [];
    this.saveToStorage();
  }

  private scheduleDailyReset(): void {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    
    const msUntilMidnight = tomorrow.getTime() - now.getTime();
    
    this.dailyResetInterval = setTimeout(() => {
      this.dailyCount = 0;
      this.lastResetDate = this.getDateKey(new Date());
      this.saveToStorage();
      
      // Schedule the next reset
      this.scheduleDailyReset();
    }, msUntilMidnight);
  }

  private saveToStorage(): void {
    // In a real Node.js app, you might want to persist this to a file or database
    // For now, we'll keep it in memory only
    // TODO: Add file-based persistence if needed
  }

  private loadFromStorage(): void {
    // TODO: Load from persistent storage if implemented
  }

  updateConfig(updates: Partial<QuotaConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  getConfig(): QuotaConfig {
    return { ...this.config };
  }

  destroy(): void {
    if (this.dailyResetInterval) {
      clearTimeout(this.dailyResetInterval);
    }
    if (this.monthlyResetInterval) {
      clearTimeout(this.monthlyResetInterval);
    }
  }
}