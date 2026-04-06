/**
 * Sequence Engine Types
 *
 * Defines the core types for the email sequence system following the
 * event-driven chain design from PRODUCTION_ARCHITECTURE_CORRECTED.md
 */

/**
 * Sequence state from email_sequence_state table
 */
export interface SequenceState {
  id: number;
  contact_id: number;
  campaign_id: number;
  sequence_tag: string;
  current_position: number;
  max_position: number;
  status: SequenceStatus;
  current_queue_id: number | null;
  last_failed_position: number | null;
  last_failed_at: Date | null;
  failure_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Possible sequence statuses
 */
export type SequenceStatus = 'active' | 'paused' | 'completed' | 'failed';

/**
 * Queue item from email_queue table (sequence-relevant fields)
 */
export interface QueueItem {
  id: number;
  contact_id: number;
  campaign_id: number;
  recipient_email: string;
  subject: string;
  html_content: string;
  text_content: string | null;
  sequence_tag: string | null;
  sequence_position: number;
  depends_on_queue_id: number | null;
  status: QueueStatus;
  scheduled_at: Date | null;
  started_at: Date | null;
  completed_at: Date | null;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  last_error_at: Date | null;
  processing_token: string | null;
  country_code: string;
  sender_id: number | null;
  template_id: number | null;
  priority: number;
  created_at: Date;
}

/**
 * Possible queue statuses
 */
export type QueueStatus = 'pending' | 'scheduled' | 'acquired' | 'sent' | 'failed' | 'failed_permanent';

/**
 * Email template from email_templates table
 */
export interface EmailTemplate {
  id: number;
  name: string;
  subject: string;
  html_content: string;
  text_content: string | null;
  sequence_number: number;
  tags: string[];
  is_active: boolean;
  category: string;
  description: string | null;
  created_at: Date;
  updated_at: Date;
}

/**
 * Result of initializing a sequence
 */
export interface InitializeSequenceResult {
  state: SequenceState;
  isFirstEmail: boolean;
  nextTemplate?: EmailTemplate;
}

/**
 * Result of processing a sent email in sequence
 */
export interface OnEmailSentResult {
  advanced: boolean;
  nextPosition?: number;
  nextScheduledAt?: Date;
  nextQueueId?: number;
  sequenceCompleted?: boolean;
}

/**
 * Result of recovery operation
 */
export interface RecoveryResult {
  recoveredCount: number;
  sequenceStatesReset: number;
  details: Array<{
    queueId: number;
    contactId: number;
    reason: string;
  }>;
}

/**
 * Transaction interface for database operations
 * This should be implemented by the database layer
 */
export interface Transaction {
  query(sql: string, params?: any[]): Promise<{ rows: any[]; rowCount?: number }>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
}

/**
 * Database pool interface
 */
export interface DatabasePool {
  beginTransaction(): Promise<Transaction>;
  query(sql: string, params?: any[]): Promise<{ rows: any[]; rowCount?: number }>;
}

/**
 * Email queue interface for scheduling follow-ups
 */
export interface EmailQueue {
  add(name: string, data: any, options?: { delay?: number; jobId?: string }): Promise<void>;
}

/**
 * Error classification for sequence handling
 */
export enum ErrorType {
  PERMANENT = 'permanent',
  TRANSIENT = 'transient',
  UNKNOWN = 'unknown',
}

/**
 * Sequence configuration
 */
export interface SequenceConfig {
  defaultFollowUpDelayMs: number;
  stuckJobTimeoutMs: number;
  maxRecoveryAttempts: number;
}
