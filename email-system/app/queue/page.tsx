"use client";

import { useState } from "react";
import { usePolling } from "@/lib/hooks/use-polling";
import { queueApi, type EmailQueueItem, type QueueQuery } from "@/lib/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  RefreshCw,
  Clock,
  Send,
  CheckCircle,
  XCircle,
  Ban,
  Globe,
  Mail,
  RotateCcw,
  Pause,
  Play,
  Zap,
} from "lucide-react";

export default function QueuePage() {
  const [query, setQuery] = useState<QueueQuery>({
    page: 1,
    limit: 50,
  });

  const { data: response, isLoading, error, refetch } = usePolling({
    fn: () => queueApi.list(query),
    interval: 10000,
  });

  const { data: stats } = usePolling({
    fn: queueApi.getStats,
    interval: 10000,
  });

  const queueItems = response?.items ?? [];
  const total = response?.pagination?.total ?? 0;
  const limit = response?.pagination?.limit ?? 50;
  const totalPages = Math.ceil(total / limit);

  const handleFilter = (key: keyof QueueQuery, value: string | number | undefined) => {
    setQuery((prev) => ({ ...prev, page: 1, [key]: value }));
  };

  const handleCancel = async (id: number) => {
    try {
      await queueApi.cancel(id);
      toast.success("Queue item cancelled");
      refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to cancel");
    }
  };

  const handleRetry = async (id: number) => {
    try {
      await queueApi.retry(id);
      toast.success("Queue item will be retried");
      refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to retry");
    }
  };

  const handlePause = async () => {
    try {
      await queueApi.pause();
      toast.success("Queue paused");
      refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to pause queue");
    }
  };

  const handleResume = async () => {
    try {
      await queueApi.resume();
      toast.success("Queue resumed");
      refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to resume queue");
    }
  };

  const handleTrigger = async () => {
    try {
      await queueApi.trigger();
      toast.success("Queue triggered");
      refetch();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to trigger queue");
    }
  };

  const getStatusBadge = (status: EmailQueueItem["status"]) => {
    switch (status) {
      case "queued":
        return (
          <Badge variant="outline" className="gap-1">
            <Clock className="h-3 w-3" />
            Queued
          </Badge>
        );
      case "sending":
        return (
          <Badge className="gap-1 bg-blue-600">
            <RefreshCw className="h-3 w-3 animate-spin" />
            Sending
          </Badge>
        );
      case "sent":
        return (
          <Badge className="gap-1 bg-green-600">
            <CheckCircle className="h-3 w-3" />
            Sent
          </Badge>
        );
      case "failed":
        return (
          <Badge variant="destructive" className="gap-1">
            <XCircle className="h-3 w-3" />
            Failed
          </Badge>
        );
      case "cancelled":
        return (
          <Badge variant="secondary" className="gap-1">
            <Ban className="h-3 w-3" />
            Cancelled
          </Badge>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Email Queue</h2>
          <p className="text-muted-foreground">
            Monitor and manage outgoing emails
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={handleTrigger} variant="outline" size="sm">
            <Zap className="h-4 w-4 mr-2" />
            Trigger
          </Button>
          <Button onClick={handlePause} variant="outline" size="sm">
            <Pause className="h-4 w-4 mr-2" />
            Pause
          </Button>
          <Button onClick={handleResume} variant="outline" size="sm">
            <Play className="h-4 w-4 mr-2" />
            Resume
          </Button>
          <Button onClick={refetch} variant="outline" size="icon">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-5">
        <StatCard
          title="Queued"
          value={stats?.queued ?? 0}
          icon={Clock}
          color="text-yellow-600"
          bgColor="bg-yellow-100 dark:bg-yellow-900/20"
        />
        <StatCard
          title="Sending"
          value={stats?.sending ?? 0}
          icon={RefreshCw}
          color="text-blue-600"
          bgColor="bg-blue-100 dark:bg-blue-900/20"
        />
        <StatCard
          title="Sent"
          value={stats?.sent ?? 0}
          icon={CheckCircle}
          color="text-green-600"
          bgColor="bg-green-100 dark:bg-green-900/20"
        />
        <StatCard
          title="Failed"
          value={stats?.failed ?? 0}
          icon={XCircle}
          color="text-red-600"
          bgColor="bg-red-100 dark:bg-red-900/20"
        />
        <StatCard
          title="Cancelled"
          value={stats?.cancelled ?? 0}
          icon={Ban}
          color="text-gray-600"
          bgColor="bg-gray-100 dark:bg-gray-900/20"
        />
      </div>

      {/* Filters Card */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-4 flex-wrap">
            <Select
              value={query.status ?? "all"}
              onValueChange={(v) => handleFilter("status", v === "all" ? undefined : v)}
            >
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="queued">Queued</SelectItem>
                <SelectItem value="sending">Sending</SelectItem>
                <SelectItem value="sent">Sent</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Queue Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Queue Items</span>
            <span className="text-sm font-normal text-muted-foreground">
              {total} total items
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && queueItems.length === 0 ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : error ? (
            <div className="text-center py-8 text-muted-foreground">
              Error loading queue
            </div>
          ) : queueItems.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No queue items found
            </div>
          ) : (
            <>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Status</TableHead>
                      <TableHead>Recipient</TableHead>
                      <TableHead>Campaign</TableHead>
                      <TableHead>Sender</TableHead>
                      <TableHead>Scheduled</TableHead>
                      <TableHead>Attempts</TableHead>
                      <TableHead className="w-[50px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {queueItems.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>{getStatusBadge(item.status)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 max-w-[250px]">
                            <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                            <div>
                              <div className="text-sm font-medium truncate" title={item.recipient_email}>
                                {item.recipient_email}
                              </div>
                              {item.recipient_name && (
                                <div className="text-xs text-muted-foreground truncate">
                                  {item.recipient_name}
                                </div>
                              )}
                              {item.site_url && (
                                <div className="text-xs text-muted-foreground flex items-center gap-1">
                                  <Globe className="h-3 w-3" />
                                  {item.site_url}
                                </div>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          {item.campaign_id ? (
                            <Badge variant="outline" className="text-xs">
                              Campaign #{item.campaign_id}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {item.sender_id ? (
                            <Badge variant="outline" className="text-xs">
                              Sender #{item.sender_id}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {item.scheduled_at
                            ? new Date(item.scheduled_at).toLocaleString()
                            : new Date(item.created_at).toLocaleString()}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {item.attempts}
                          </Badge>
                          {item.error_message && (
                            <span className="block text-xs text-destructive mt-1 truncate max-w-[200px]">
                              {item.error_message}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <QueueActions
                            item={item}
                            onCancel={handleCancel}
                            onRetry={handleRetry}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <div className="text-sm text-muted-foreground">
                    Showing {((query.page ?? 1) - 1) * limit + 1} to{" "}
                    {Math.min((query.page ?? 1) * limit, total)} of {total}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setQuery((prev) => ({ ...prev, page: (prev.page ?? 1) - 1 }))}
                      disabled={(query.page ?? 1) === 1}
                    >
                      Previous
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setQuery((prev) => ({ ...prev, page: (prev.page ?? 1) + 1 }))}
                      disabled={(query.page ?? 1) >= totalPages}
                    >
                      Next
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  title,
  value,
  icon: Icon,
  color,
  bgColor,
}: {
  title: string;
  value: number;
  icon: React.ElementType;
  color: string;
  bgColor: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold">{value.toLocaleString()}</p>
          </div>
          <div className={`p-3 rounded-lg ${bgColor}`}>
            <Icon className={`h-6 w-6 ${color}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function QueueActions({
  item,
  onCancel,
  onRetry,
}: {
  item: EmailQueueItem;
  onCancel: (id: number) => void;
  onRetry: (id: number) => void;
}) {
  if (item.status === "queued" || item.status === "sending") {
    return (
      <Button
        variant="ghost"
        size="icon"
        onClick={() => onCancel(item.id)}
        title="Cancel"
      >
        <Ban className="h-4 w-4 text-destructive" />
      </Button>
    );
  }

  if (item.status === "failed") {
    return (
      <Button
        variant="ghost"
        size="icon"
        onClick={() => onRetry(item.id)}
        title="Retry"
      >
        <RotateCcw className="h-4 w-4" />
      </Button>
    );
  }

  return null;
}
