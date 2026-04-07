"use client";

import * as React from "react";
import {
  Search,
  Filter,
  RefreshCw,
  Mail,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Calendar,
  FileText,
  Users,
  TrendingUp,
  Circle,
  MoreHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { cn, formatDate } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface QueueItem {
  id: string;
  campaign_id: string;
  campaign_name?: string;
  sender_id?: string;
  recipient_email: string;
  recipient_name: string | null;
  subject: string;
  html_content?: string;
  status: "queued" | "sending" | "sent" | "failed" | "cancelled" | "pending" | "scheduled" | "ready_to_send";
  attempts: number;
  error_message: string | null;
  sent_at: string | null;
  scheduled_at: string | null;
  adjusted_scheduled_at?: string | null;
  country_code: string;
  tag: string | null;
  created_at: string;
  updated_at: string;
  sequence_position?: number;
  contact_id?: string;
  template_id?: string;
  source?: string;
}

interface SequenceEmail {
  position: number;
  subject: string;
  status: QueueItem['status'];
  scheduled_at: string | null;
  sent_at: string | null;
  queue_id: string;
  template_id?: string;
}

interface ContactGroup {
  email: string;
  name: string | null;
  emails: QueueItem[];
  stats: {
    total: number;
    sent: number;
    failed: number;
    queued: number;
    sending: number;
  };
  campaigns: string[];
  sequences: Map<string, SequenceEmail[]>; // campaign_id -> sequence emails
}

type StatusFilter = "all" | "sent" | "failed" | "cancelled" | "queued" | "sending" | "pending";

export default function HistoryPage() {
  const [items, setItems] = React.useState<QueueItem[]>([]);
  const [contactGroups, setContactGroups] = React.useState<ContactGroup[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("all");
  const [searchQuery, setSearchQuery] = React.useState("");
  const [expandedContacts, setExpandedContacts] = React.useState<Set<string>>(new Set());
  const [expandedSequences, setExpandedSequences] = React.useState<Set<string>>(new Set());
  const [selectedEmail, setSelectedEmail] = React.useState<QueueItem | null>(null);
  const [modalOpen, setModalOpen] = React.useState(false);

  const fetchQueue = async (quiet = false) => {
    if (!quiet) setLoading(true);
    else setRefreshing(true);

    try {
      const statusParam =
        statusFilter !== "all" ? `&status=${statusFilter}` : "";
      const res = await fetch(
        `/api/queue?limit=500&offset=0${statusParam}`
      );
      const json = await res.json();
      if (json.success) {
        setItems(json.data);
      }
    } catch (err) {
      console.error(err);
    } finally {
      if (!quiet) setLoading(false);
      setRefreshing(false);
    }
  };

  React.useEffect(() => {
    fetchQueue();
  }, [statusFilter]);

  // Group items by contact and sequence
  React.useEffect(() => {
    if (items.length === 0) {
      setContactGroups([]);
      return;
    }

    const grouped = new Map<string, QueueItem[]>();

    for (const item of items) {
      const email = item.recipient_email.toLowerCase();
      if (!grouped.has(email)) {
        grouped.set(email, []);
      }
      grouped.get(email)!.push(item);
    }

    const groups: ContactGroup[] = [];

    for (const [email, emailItems] of grouped) {
      // Filter by search query
      if (searchQuery && !email.includes(searchQuery.toLowerCase())) {
        const hasMatch = emailItems.some(
          (item) =>
            item.subject?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            item.campaign_name?.toLowerCase().includes(searchQuery.toLowerCase())
        );
        if (!hasMatch) continue;
      }

      const stats = {
        total: emailItems.length,
        sent: emailItems.filter((i) => i.status === "sent").length,
        failed: emailItems.filter((i) => i.status === "failed").length,
        queued: emailItems.filter((i) => ["queued", "pending", "scheduled", "ready_to_send"].includes(i.status)).length,
        sending: emailItems.filter((i) => i.status === "sending").length,
      };

      const campaigns = [...new Set(emailItems.map((i) => i.campaign_name || i.campaign_id))];

      // Group by campaign (sequence)
      const sequences = new Map<string, SequenceEmail[]>();
      const itemsByCampaign = new Map<string, QueueItem[]>();

      for (const item of emailItems) {
        const campaignId = item.campaign_id || 'uncategorized';
        if (!itemsByCampaign.has(campaignId)) {
          itemsByCampaign.set(campaignId, []);
        }
        itemsByCampaign.get(campaignId)!.push(item);
      }

      for (const [campaignId, campaignItems] of itemsByCampaign) {
        const sequenceEmails: SequenceEmail[] = campaignItems
          .sort((a, b) => (a.sequence_position || 0) - (b.sequence_position || 0))
          .map(item => ({
            position: item.sequence_position || 0,
            subject: item.subject,
            status: item.status,
            scheduled_at: item.adjusted_scheduled_at || item.scheduled_at,
            sent_at: item.sent_at,
            queue_id: item.id,
            template_id: item.template_id,
          }));

        sequences.set(campaignId, sequenceEmails);
      }

      groups.push({
        email,
        name: emailItems[0].recipient_name,
        emails: emailItems.sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        ),
        stats,
        campaigns,
        sequences,
      });
    }

    // Sort groups by most recent activity
    groups.sort((a, b) => {
      const aLatest = new Date(a.emails[0].created_at).getTime();
      const bLatest = new Date(b.emails[0].created_at).getTime();
      return bLatest - aLatest;
    });

    setContactGroups(groups);
  }, [items, searchQuery]);

  const toggleContactExpanded = (email: string) => {
    setExpandedContacts((prev) => {
      const next = new Set(prev);
      if (next.has(email)) {
        next.delete(email);
      } else {
        next.add(email);
      }
      return next;
    });
  };

  const toggleSequenceExpanded = (key: string) => {
    setExpandedSequences((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const getStats = () => {
    return {
      total: items.length,
      sent: items.filter((i) => i.status === "sent").length,
      failed: items.filter((i) => i.status === "failed").length,
      queued: items.filter((i) => ["queued", "pending", "scheduled", "ready_to_send"].includes(i.status)).length,
      sending: items.filter((i) => i.status === "sending").length,
      contacts: contactGroups.length,
    };
  };

  const stats = getStats();

  const formatScheduleDate = (dateStr: string | null) => {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    const now = new Date();
    const isPast = date < now;

    return {
      full: date.toLocaleString(),
      short: formatDate(dateStr),
      relative: isPast
        ? `was ${formatDate(dateStr)}`
        : date.toDateString() === now.toDateString()
        ? `today at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
        : date.getDate() - now.getDate() === 1
        ? `tomorrow at ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
        : `in ${Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))} days`,
    };
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h2 className="text-3xl font-bold tracking-tight">Email History</h2>
          <p className="text-muted-foreground">
            View all email sending history grouped by contact and sequence
          </p>
        </div>
        <Button
          variant="outline"
          className="gap-2"
          onClick={() => fetchQueue(true)}
          disabled={refreshing}
        >
          <RefreshCw
            className={cn("h-4 w-4", refreshing && "animate-spin")}
          />
          Refresh
        </Button>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <StatCard
          title="Contacts"
          value={stats.contacts}
          color="bg-gray-500/10 text-gray-500 border-gray-500/20"
          icon={Users}
        />
        <StatCard
          title="Total Emails"
          value={stats.total}
          color="bg-blue-500/10 text-blue-500 border-blue-500/20"
          icon={Mail}
        />
        <StatCard
          title="Sent"
          value={stats.sent}
          color="bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
          icon={CheckCircle2}
        />
        <StatCard
          title="Failed"
          value={stats.failed}
          color="bg-destructive/10 text-destructive border-destructive/20"
          icon={XCircle}
        />
        <StatCard
          title="Queued"
          value={stats.queued}
          color="bg-amber-500/10 text-amber-500 border-amber-500/20"
          icon={Clock}
        />
        <StatCard
          title="Sending"
          value={stats.sending}
          color="bg-purple-500/10 text-purple-500 border-purple-500/20"
          icon={TrendingUp}
        />
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row md:items-center gap-4 justify-between border-b pb-4 -mx-6 px-6">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                className="w-full bg-muted/40 border border-input rounded-lg pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="Search contact email or campaign..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <FilterButton
                active={statusFilter === "all"}
                onClick={() => setStatusFilter("all")}
              >
                All
              </FilterButton>
              <FilterButton
                active={statusFilter === "sent"}
                onClick={() => setStatusFilter("sent")}
              >
                Sent
              </FilterButton>
              <FilterButton
                active={statusFilter === "failed"}
                onClick={() => setStatusFilter("failed")}
              >
                Failed
              </FilterButton>
              <FilterButton
                active={statusFilter === "queued"}
                onClick={() => setStatusFilter("queued")}
              >
                Queued
              </FilterButton>
              <FilterButton
                active={statusFilter === "sending"}
                onClick={() => setStatusFilter("sending")}
              >
                Sending
              </FilterButton>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-8 space-y-4">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-24 bg-muted animate-pulse rounded-lg" />
              ))}
            </div>
          ) : contactGroups.length === 0 ? (
            <div className="p-16 text-center">
              <div className="flex flex-col items-center gap-2 opacity-40">
                <Mail className="h-12 w-12" />
                <p className="font-medium text-lg">No emails found</p>
              </div>
            </div>
          ) : (
            <div className="divide-y">
              {contactGroups.map((group) => (
                <ContactCard
                  key={group.email}
                  group={group}
                  isExpanded={expandedContacts.has(group.email)}
                  expandedSequences={expandedSequences}
                  onContactToggle={() => toggleContactExpanded(group.email)}
                  onSequenceToggle={(key) => toggleSequenceExpanded(key)}
                  onEmailClick={(email) => {
                    setSelectedEmail(email);
                    setModalOpen(true);
                  }}
                  formatScheduleDate={formatScheduleDate}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Email Details Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Email Details</DialogTitle>
            <DialogDescription>
              Full information about this email
            </DialogDescription>
          </DialogHeader>
          {selectedEmail && (
            <div className="space-y-4">
              <DetailRow
                icon={Mail}
                label="Recipient"
                value={`${selectedEmail.recipient_name ? selectedEmail.recipient_name + " " : ""}<${selectedEmail.recipient_email}>`}
              />
              <DetailRow
                icon={FileText}
                label="Subject"
                value={selectedEmail.subject}
              />
              {selectedEmail.sequence_position && (
                <DetailRow
                  icon={TrendingUp}
                  label="Sequence Position"
                  value={`Step ${selectedEmail.sequence_position}`}
                />
              )}
              <DetailRow
                icon={User}
                label="Campaign"
                value={selectedEmail.campaign_name || selectedEmail.campaign_id}
              />
              <DetailRow
                icon={Calendar}
                label="Scheduled"
                value={
                  selectedEmail.adjusted_scheduled_at || selectedEmail.scheduled_at
                    ? new Date(selectedEmail.adjusted_scheduled_at || selectedEmail.scheduled_at || '').toLocaleString()
                    : "Not scheduled"
                }
              />
              <DetailRow
                icon={CheckCircle2}
                label="Sent At"
                value={
                  selectedEmail.sent_at
                    ? new Date(selectedEmail.sent_at).toLocaleString()
                    : "Not sent yet"
                }
              />
              <DetailRow
                icon={AlertCircle}
                label="Status"
                value={<QueueStatusBadge status={selectedEmail.status} />}
              />
              {selectedEmail.error_message && (
                <DetailRow
                  icon={XCircle}
                  label="Error"
                  value={selectedEmail.error_message}
                  className="text-destructive"
                />
              )}
              <DetailRow
                icon={Clock}
                label="Attempts"
                value={selectedEmail.attempts.toString()}
              />
              {selectedEmail.html_content && (
                <div className="pt-4 border-t">
                  <p className="text-sm font-medium mb-2">HTML Content</p>
                  <div
                    className="p-4 bg-muted rounded-lg text-xs overflow-auto max-h-64"
                    dangerouslySetInnerHTML={{ __html: selectedEmail.html_content }}
                  />
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ContactCard({
  group,
  isExpanded,
  expandedSequences,
  onContactToggle,
  onSequenceToggle,
  onEmailClick,
  formatScheduleDate,
}: {
  group: ContactGroup;
  isExpanded: boolean;
  expandedSequences: Set<string>;
  onContactToggle: () => void;
  onSequenceToggle: (key: string) => void;
  onEmailClick: (email: QueueItem) => void;
  formatScheduleDate: (date: string | null) => null | { full: string; short: string; relative: string };
}) {
  return (
    <div className="hover:bg-muted/30 transition-colors">
      <div
        className="p-4 cursor-pointer flex items-center justify-between gap-4"
        onClick={onContactToggle}
      >
        <div className="flex items-center gap-4 flex-1 min-w-0">
          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <span className="text-sm font-semibold text-primary">
              {group.email.charAt(0).toUpperCase()}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-medium truncate">{group.email}</p>
              {group.name && (
                <span className="text-xs text-muted-foreground">({group.name})</span>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1 flex-wrap">
              <span className="text-xs text-muted-foreground">
                {group.stats.total} email{group.stats.total !== 1 ? "s" : ""}
              </span>
              <span className="text-xs text-emerald-500">
                {group.stats.sent} sent
              </span>
              {group.stats.queued > 0 && (
                <span className="text-xs text-amber-500">
                  {group.stats.queued} queued
                </span>
              )}
              {group.stats.failed > 0 && (
                <span className="text-xs text-destructive">
                  {group.stats.failed} failed
                </span>
              )}
              <span className="text-xs text-muted-foreground">
                {group.campaigns.length} sequence{group.campaigns.length !== 1 ? "s" : ""}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <SequenceProgressIndicator
            sent={group.stats.sent}
            total={group.stats.total}
          />
          <Button variant="ghost" size="icon" className="shrink-0">
            {isExpanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      {/* Expanded Sequences */}
      {isExpanded && (
        <div className="border-t bg-muted/20 p-4 space-y-3">
          {Array.from(group.sequences.entries()).map(([campaignId, sequenceEmails]) => {
            const seqKey = `${group.email}-${campaignId}`;
            const isSeqExpanded = expandedSequences.has(seqKey);
            const sentCount = sequenceEmails.filter(e => e.status === 'sent').length;
            const totalCount = sequenceEmails.length;
            const campaignName = group.campaigns.find(c => c.startsWith(campaignId)) || campaignId;

            return (
              <div key={campaignId} className="border rounded-lg bg-background overflow-hidden">
                <div
                  className="p-3 cursor-pointer hover:bg-muted/50 flex items-center justify-between"
                  onClick={() => onSequenceToggle(seqKey)}
                >
                  <div className="flex items-center gap-3">
                    <TrendingUp className="h-4 w-4 text-primary" />
                    <span className="font-medium text-sm">{campaignName}</span>
                    <span className="text-xs text-muted-foreground">
                      {sentCount}/{totalCount} emails sent
                    </span>
                  </div>
                  <Button variant="ghost" size="icon" className="h-6 w-6">
                    {isSeqExpanded ? (
                      <ChevronUp className="h-3 w-3" />
                    ) : (
                      <ChevronDown className="h-3 w-3" />
                    )}
                  </Button>
                </div>

                {isSeqExpanded && (
                  <div className="border-t p-3 space-y-2">
                    {/* Timeline */}
                    <div className="relative">
                      {/* Vertical line */}
                      <div className="absolute left-2.75 top-2 bottom-2 w-0.5 bg-border" />

                      {sequenceEmails.map((email, idx) => {
                        const schedule = formatScheduleDate(email.scheduled_at);
                        const isLast = idx === sequenceEmails.length - 1;

                        return (
                          <div key={email.queue_id} className="relative flex gap-3 pb-3 last:pb-0">
                            {/* Status dot on timeline */}
                            <div className="relative z-10 flex flex-col items-center">
                              <StatusDot status={email.status} />
                              {!isLast && (
                                <div className="w-0.5 h-full bg-border min-h-6" />
                              )}
                            </div>

                            {/* Email card */}
                            <div
                              className="flex-1 min-w-0 p-3 rounded-lg border hover:bg-muted/50 cursor-pointer transition-colors"
                              onClick={(e) => {
                                e.stopPropagation();
                                // Find full email item
                                const fullItem = group.emails.find(item => item.id === email.queue_id);
                                if (fullItem) onEmailClick(fullItem);
                              }}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-medium text-muted-foreground">
                                      Email {email.position}
                                    </span>
                                    <QueueStatusBadge status={email.status} />
                                  </div>
                                  <p className="text-sm font-medium truncate mt-1">{email.subject}</p>
                                  {schedule && (
                                    <p className="text-xs text-muted-foreground mt-1">
                                      {email.status === 'sent'
                                        ? `Sent ${schedule.short}`
                                        : email.status === 'failed'
                                        ? 'Failed to send'
                                        : schedule.relative}
                                    </p>
                                  )}
                                </div>
                                {email.status !== 'sent' && email.status !== 'failed' && schedule && (
                                  <div className="text-right shrink-0">
                                    <p className="text-xs text-muted-foreground">Scheduled</p>
                                    <p className="text-sm font-medium">{schedule.short}</p>
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatusDot({ status }: { status: QueueItem['status'] }) {
  const s = status.toLowerCase();
  if (s === "sent")
    return (
      <div className="h-6 w-6 rounded-full bg-emerald-500 flex items-center justify-center">
        <CheckCircle2 className="h-3 w-3 text-white" />
      </div>
    );
  if (s === "failed")
    return (
      <div className="h-6 w-6 rounded-full bg-destructive flex items-center justify-center">
        <XCircle className="h-3 w-3 text-white" />
      </div>
    );
  return (
    <div className="h-6 w-6 rounded-full bg-amber-500 flex items-center justify-center">
      <Clock className="h-3 w-3 text-white" />
    </div>
  );
}

function SequenceProgressIndicator({ sent, total }: { sent: number; total: number }) {
  const percent = total > 0 ? Math.round((sent / total) * 100) : 0;

  return (
    <div className="hidden sm:block w-24">
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${percent}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground mt-1 text-center">
        {sent}/{total}
      </p>
    </div>
  );
}

function StatCard({
  title,
  value,
  color,
  icon: Icon,
}: {
  title: string;
  value: number;
  color: string;
  icon: any;
}) {
  return (
    <Card className={cn(color)}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4" />
          <div>
            <p className="text-xs font-medium uppercase opacity-70">{title}</p>
            <p className="text-xl font-bold">{value}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function FilterButton({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      variant={active ? "default" : "outline"}
      size="sm"
      onClick={onClick}
      className="h-8"
    >
      {children}
    </Button>
  );
}

function QueueStatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase();
  if (s === "sent")
    return (
      <span className="bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 px-2 py-0.5 rounded-full text-xs font-semibold">
        Sent
      </span>
    );
  if (s === "failed")
    return (
      <span className="bg-destructive/10 text-destructive border border-destructive/20 px-2 py-0.5 rounded-full text-xs font-semibold">
        Failed
      </span>
    );
  if (s === "cancelled")
    return (
      <span className="bg-muted text-muted-foreground border px-2 py-0.5 rounded-full text-xs font-semibold">
        Cancelled
      </span>
    );
  if (s === "pending" || s === "queued" || s === "scheduled" || s === "ready_to_send")
    return (
      <span className="bg-blue-500/10 text-blue-500 border border-blue-500/20 px-2 py-0.5 rounded-full text-xs font-semibold">
        Queued
      </span>
    );
  if (s === "sending")
    return (
      <span className="bg-amber-500/10 text-amber-500 border border-amber-500/20 px-2 py-0.5 rounded-full text-xs font-semibold">
        Sending
      </span>
    );
  return (
    <span className="bg-muted text-muted-foreground border px-2 py-0.5 rounded-full text-xs font-semibold uppercase">
      {status}
    </span>
  );
}

function DetailRow({
  icon: Icon,
  label,
  value,
  className,
}: {
  icon: any;
  label: string;
  value: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start gap-3", className)}>
      <Icon className="h-4 w-4 text-muted-foreground mt-0.5" />
      <div className="flex-1">
        <p className="text-xs text-muted-foreground mb-1">{label}</p>
        <p className="text-sm font-medium">{value}</p>
      </div>
    </div>
  );
}

function User({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}
