"use client";

import { usePolling } from "@/lib/hooks/use-polling";
import { healthApi, queueApi, sendersApi, campaignsApi } from "@/lib/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users,
  Clock,
  Send,
  CheckCircle,
  AlertCircle,
  Activity,
  Zap,
  Pause,
} from "lucide-react";

export default function DashboardPage() {
  const { data: health, isLoading: healthLoading } = usePolling({
    fn: healthApi.getStatus,
    interval: 30000,
  });

  const { data: queueStats } = usePolling({
    fn: queueApi.getStats,
    interval: 30000,
  });

  const { data: senders } = usePolling({
    fn: sendersApi.list,
    interval: 60000,
  });

  const { data: campaigns } = usePolling({
    fn: () => campaignsApi.list(),
    interval: 60000,
  });

  const activeSenders = senders?.filter((s) => s.is_active).length ?? 0;
  const activeCampaigns = campaigns?.filter((c) => c.status === "running" || c.status === "queued").length ?? 0;

  const statCards = [
    {
      title: "Queue Status",
      value: health?.is_running ? "Running" : "Stopped",
      icon: health?.is_running ? Activity : Pause,
      color: health?.is_running ? "text-green-600" : "text-red-600",
      bgColor: health?.is_running ? "bg-green-100 dark:bg-green-900/20" : "bg-red-100 dark:bg-red-900/20",
    },
    {
      title: "Queued Emails",
      value: queueStats?.queued ?? 0,
      icon: Clock,
      color: "text-yellow-600",
      bgColor: "bg-yellow-100 dark:bg-yellow-900/20",
    },
    {
      title: "Sent Emails",
      value: queueStats?.sent ?? 0,
      icon: Send,
      color: "text-purple-600",
      bgColor: "bg-purple-100 dark:bg-purple-900/20",
    },
    {
      title: "Failed Emails",
      value: queueStats?.failed ?? 0,
      icon: AlertCircle,
      color: "text-red-600",
      bgColor: "bg-red-100 dark:bg-red-900/20",
    },
    {
      title: "Active Campaigns",
      value: activeCampaigns,
      icon: CheckCircle,
      color: "text-emerald-600",
      bgColor: "bg-emerald-100 dark:bg-emerald-900/20",
    },
    {
      title: "Active Senders",
      value: activeSenders,
      icon: Zap,
      color: "text-orange-600",
      bgColor: "bg-orange-100 dark:bg-orange-900/20",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div>
        <h2 className="text-3xl font-bold tracking-tight">Dashboard</h2>
        <p className="text-muted-foreground">
          Overview of your lead generation and email campaigns
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {statCards.map((stat) => (
          <StatCard key={stat.title} {...stat} isLoading={healthLoading} />
        ))}
      </div>

      {/* Recent Activity */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            System Status
          </CardTitle>
        </CardHeader>
        <CardContent>
          {healthLoading ? (
            <div className="space-y-3">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : health ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                <span className="text-sm font-medium">Worker Status</span>
                <span className={`text-sm ${health.is_running ? "text-green-600" : "text-red-600"}`}>
                  {health.is_running ? "Running" : "Stopped"}
                </span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                <span className="text-sm font-medium">Paused</span>
                <span className="text-sm">{health.is_paused ? "Yes" : "No"}</span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                <span className="text-sm font-medium">Uptime</span>
                <span className="text-sm">{health.uptime}</span>
              </div>
              <div className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                <span className="text-sm font-medium">Last Check</span>
                <span className="text-sm">{new Date(health.last_check).toLocaleString()}</span>
              </div>
              {health.countries_in_business && health.countries_in_business.length > 0 && (
                <div className="p-3 rounded-lg bg-muted/50">
                  <span className="text-sm font-medium block mb-2">Countries in Business Hours</span>
                  <div className="flex flex-wrap gap-1">
                    {health.countries_in_business.map((country) => (
                      <span
                        key={country.code}
                        className="text-xs px-2 py-1 rounded bg-green-100 text-green-700"
                      >
                        {country.code.toUpperCase()}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              Unable to load system status
            </div>
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
  isLoading,
}: {
  title: string;
  value: number;
  icon: React.ElementType;
  color: string;
  bgColor: string;
  isLoading: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <div className={`p-2 rounded-lg ${bgColor}`}>
          <Icon className={`h-4 w-4 ${color}`} />
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-8 w-20" />
        ) : (
          <div className="text-2xl font-bold">{value.toLocaleString()}</div>
        )}
      </CardContent>
    </Card>
  );
}

