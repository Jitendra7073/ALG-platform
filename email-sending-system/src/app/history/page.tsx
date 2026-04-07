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
  AlertCircle,
  X,
  ChevronDown,
  ChevronUp,
  Calendar,
  User,
  FileText,
  Globe,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
  sender_id: string;
  recipient_email: string;
  recipient_name: string | null;
  subject: string;
  html_content: string;
  status: "queued" | "sending" | "sent" | "failed" | "cancelled";
  attempts: number;
  error_message: string | null;
  sent_at: string | null;
  scheduled_at: string | null;
  country_code: string;
  tag: string | null;
  created_at: string;
  updated_at: string;
}

type StatusFilter = "all" | "sent" | "failed" | "cancelled" | "queued" | "sending";

export default function HistoryPage() {
  const [items, setItems] = React.useState<QueueItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [pagination, setPagination] = React.useState({
    total: 0,
    limit: 50,
    offset: 0,
    totalPages: 1,
  });
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("all");
  const [searchQuery, setSearchQuery] = React.useState("");
  const [selectedItem, setSelectedItem] = React.useState<QueueItem | null>(null);
  const [modalOpen, setModalOpen] = React.useState(false);

  const fetchQueue = async (quiet = false) => {
    if (!quiet) setLoading(true);
    else setRefreshing(true);

    try {
      const statusParam =
        statusFilter !== "all" ? `&status=${statusFilter}` : "";
      const searchParam = searchQuery
        ? `&search=${encodeURIComponent(searchQuery)}`
        : "";
      const res = await fetch(
        `/api/queue?limit=50&offset=${pagination.offset}${statusParam}${searchParam}`
      );
      const json = await res.json();
      if (json.success) {
        setItems(json.data);
        setPagination(json.pagination || { total: json.data.length, limit: 50, offset: 0, totalPages: 1 });
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

  const handleRowClick = (item: QueueItem) => {
    setSelectedItem(item);
    setModalOpen(true);
  };

  const getStats = () => {
    const stats = {
      total: items.length,
      sent: items.filter((i) => i.status === "sent").length,
      failed: items.filter((i) => i.status === "failed").length,
      cancelled: items.filter((i) => i.status === "cancelled").length,
      queued: items.filter((i) => i.status === "queued").length,
      sending: items.filter((i) => i.status === "sending").length,
    };
    return stats;
  };

  const stats = getStats();

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h2 className="text-3xl font-bold tracking-tight">Email History</h2>
          <p className="text-muted-foreground">
            View all email sending history and status
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
          title="Total"
          value={stats.total}
          color="bg-gray-500/10 text-gray-500 border-gray-500/20"
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
          title="Cancelled"
          value={stats.cancelled}
          color="bg-muted text-muted-foreground"
          icon={XCircle}
        />
        <StatCard
          title="Queued"
          value={stats.queued}
          color="bg-blue-500/10 text-blue-500 border-blue-500/20"
          icon={Clock}
        />
        <StatCard
          title="Sending"
          value={stats.sending}
          color="bg-amber-500/10 text-amber-500 border-amber-500/20"
          icon={AlertCircle}
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
                placeholder="Search email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && fetchQueue()}
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
                active={statusFilter === "cancelled"}
                onClick={() => setStatusFilter("cancelled")}
              >
                Cancelled
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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Recipient</TableHead>
                <TableHead>Subject</TableHead>
                <TableHead>Campaign</TableHead>
                <TableHead>Scheduled</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Attempts</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                [...Array(8)].map((_, i) => (
                  <TableRow key={i}>
                    {[...Array(7)].map((_, j) => (
                      <TableCell key={j}>
                        <div className="h-8 bg-muted animate-pulse rounded" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-64 text-center">
                    <div className="flex flex-col items-center gap-2 opacity-40">
                      <Mail className="h-12 w-12" />
                      <p className="font-medium text-lg">No emails found</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                items.map((item) => (
                  <TableRow
                    key={item.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => handleRowClick(item)}
                  >
                    <TableCell className="font-medium">
                      <div className="flex flex-col">
                        <span>{item.recipient_email}</span>
                        {item.recipient_name && (
                          <span className="text-xs text-muted-foreground">
                            {item.recipient_name}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="max-w-[250px] truncate">
                      {item.subject}
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {item.campaign_name || item.campaign_id}
                    </TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs">
                      {item.scheduled_at
                        ? formatDate(item.scheduled_at)
                        : "—"}
                    </TableCell>
                    <TableCell>
                      <QueueStatusBadge status={item.status} />
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="text-xs bg-muted px-2 py-1 rounded">
                        {item.attempts}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRowClick(item);
                        }}
                      >
                        <ChevronDown className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-center p-4 border-t gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.offset <= 0}
              onClick={() => {
                setPagination((prev) => ({
                  ...prev,
                  offset: Math.max(0, prev.offset - prev.limit),
                }));
                fetchQueue();
              }}
            >
              Previous
            </Button>
            <div className="text-xs font-medium px-4">
              Page {Math.floor(pagination.offset / pagination.limit) + 1} of{" "}
              {pagination.totalPages}
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.offset + pagination.limit >= pagination.total}
              onClick={() => {
                setPagination((prev) => ({
                  ...prev,
                  offset: prev.offset + prev.limit,
                }));
                fetchQueue();
              }}
            >
              Next
            </Button>
          </div>
        )}
      </Card>

      {/* Details Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Email Details</DialogTitle>
            <DialogDescription>
              Full information about this email queue item
            </DialogDescription>
          </DialogHeader>
          {selectedItem && (
            <div className="space-y-4">
              <DetailRow
                icon={Mail}
                label="Recipient"
                value={`${selectedItem.recipient_name ? selectedItem.recipient_name + " " : ""}<${selectedItem.recipient_email}>`}
              />
              <DetailRow
                icon={FileText}
                label="Subject"
                value={selectedItem.subject}
              />
              <DetailRow
                icon={User}
                label="Campaign"
                value={selectedItem.campaign_name || selectedItem.campaign_id}
              />
              <DetailRow
                icon={Calendar}
                label="Scheduled"
                value={
                  selectedItem.scheduled_at
                    ? new Date(selectedItem.scheduled_at).toLocaleString()
                    : "Not scheduled"
                }
              />
              <DetailRow
                icon={CheckCircle2}
                label="Sent At"
                value={
                  selectedItem.sent_at
                    ? new Date(selectedItem.sent_at).toLocaleString()
                    : "Not sent yet"
                }
              />
              <DetailRow
                icon={AlertCircle}
                label="Status"
                value={<QueueStatusBadge status={selectedItem.status} />}
              />
              <DetailRow
                icon={Globe}
                label="Country"
                value={selectedItem.country_code || "N/A"}
              />
              {selectedItem.tag && (
                <DetailRow icon={FileText} label="Tag" value={selectedItem.tag} />
              )}
              {selectedItem.error_message && (
                <DetailRow
                  icon={XCircle}
                  label="Error"
                  value={selectedItem.error_message}
                  className="text-destructive"
                />
              )}
              <DetailRow
                icon={Clock}
                label="Attempts"
                value={selectedItem.attempts.toString()}
              />
              <div className="pt-4 border-t">
                <p className="text-sm font-medium mb-2">HTML Content</p>
                <div
                  className="p-4 bg-muted rounded-lg text-xs overflow-auto max-h-64"
                  dangerouslySetInnerHTML={{ __html: selectedItem.html_content }}
                />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
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
  if (s === "pending" || s === "queued")
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
