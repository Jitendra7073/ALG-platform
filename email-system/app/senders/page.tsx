"use client";

import { useState, useEffect } from "react";
import { sendersApi, type EmailSender } from "@/lib/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  Plus,
  MoreHorizontal,
  Mail,
  CheckCircle,
  XCircle,
  RefreshCw,
  Trash2,
  Send,
  Gauge,
} from "lucide-react";

export default function SendersPage() {
  const [senders, setSenders] = useState<EmailSender[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isTesting, setIsTesting] = useState<number | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    service: "gmail" as const,
    smtp_host: "",
    smtp_port: "587",
    smtp_user: "",
    daily_limit: "500",
  });

  useEffect(() => {
    loadSenders();
  }, []);

  const loadSenders = async () => {
    setIsLoading(true);
    try {
      const data = await sendersApi.list();
      setSenders(data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load senders");
    } finally {
      setIsLoading(false);
    }
  };

  const openCreateDialog = () => {
    setFormData({
      name: "",
      email: "",
      password: "",
      service: "gmail",
      smtp_host: "",
      smtp_port: "587",
      smtp_user: "",
      daily_limit: "500",
    });
    setIsDialogOpen(true);
  };

  const handleSubmit = async () => {
    try {
      await sendersApi.create({
        ...formData,
        daily_limit: parseInt(formData.daily_limit),
        smtp_port: parseInt(formData.smtp_port),
      });
      toast.success("Sender added successfully");
      setIsDialogOpen(false);
      loadSenders();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to add sender");
    }
  };

  const handleToggle = async (id: number) => {
    try {
      await sendersApi.toggle(id);
      toast.success("Sender status updated");
      loadSenders();
    } catch (error) {
      toast.error("Failed to toggle sender status");
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await sendersApi.delete(id);
      toast.success("Sender deleted successfully");
      loadSenders();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete sender");
    }
  };

  const handleTest = async (id: number) => {
    setIsTesting(id);
    try {
      const result = await sendersApi.test(id);
      if (result.success) {
        toast.success(result.message || "Test email sent successfully");
      } else {
        toast.error(result.message || "Test failed");
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Test failed");
    } finally {
      setIsTesting(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Email Senders</h2>
          <p className="text-muted-foreground">
            Manage email accounts for sending campaigns
          </p>
        </div>
        <Button onClick={openCreateDialog}>
          <Plus className="h-4 w-4 mr-2" />
          Add Sender
        </Button>
      </div>

      {/* Senders Grid */}
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(6)].map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-4 w-1/2 mt-2" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-20 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : senders.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Mail className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No senders configured</h3>
            <p className="text-muted-foreground mb-4">
              Add an email account to start sending campaigns
            </p>
            <Button onClick={openCreateDialog}>
              <Plus className="h-4 w-4 mr-2" />
              Add Sender
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {senders.map((sender) => (
            <SenderCard
              key={sender.id}
              sender={sender}
              onToggle={() => handleToggle(sender.id)}
              onDelete={() => handleDelete(sender.id)}
              onTest={() => handleTest(sender.id)}
              isTesting={isTesting === sender.id}
            />
          ))}
        </div>
      )}

      {/* Add Sender Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Email Sender</DialogTitle>
            <DialogDescription>
              Add a new email account for sending campaigns
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Sender Name</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="John Doe"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="john@example.com"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="service">Provider</Label>
              <Select
                value={formData.service}
                onValueChange={(v: any) => setFormData({ ...formData, service: v })}
              >
                <SelectTrigger id="service">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gmail">Gmail</SelectItem>
                  <SelectItem value="smtp">Custom SMTP</SelectItem>
                  <SelectItem value="sendgrid">SendGrid</SelectItem>
                  <SelectItem value="mailgun">Mailgun</SelectItem>
                  <SelectItem value="ses">Amazon SES</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password / App Password</Label>
              <Input
                id="password"
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                placeholder="Enter password or app password"
              />
            </div>

            {(formData.service === "custom" || formData.service === "smtp") && (
              <>
                <div className="space-y-2">
                  <Label htmlFor="smtp_host">SMTP Host</Label>
                  <Input
                    id="smtp_host"
                    value={formData.smtp_host}
                    onChange={(e) => setFormData({ ...formData, smtp_host: e.target.value })}
                    placeholder="smtp.example.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="smtp_port">SMTP Port</Label>
                  <Input
                    id="smtp_port"
                    type="number"
                    value={formData.smtp_port}
                    onChange={(e) => setFormData({ ...formData, smtp_port: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="smtp_user">SMTP User (if different)</Label>
                  <Input
                    id="smtp_user"
                    value={formData.smtp_user}
                    onChange={(e) => setFormData({ ...formData, smtp_user: e.target.value })}
                  />
                </div>
              </>
            )}

            <div className="space-y-2">
              <Label htmlFor="daily_limit">Daily Limit</Label>
              <Input
                id="daily_limit"
                type="number"
                value={formData.daily_limit}
                onChange={(e) => setFormData({ ...formData, daily_limit: e.target.value })}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit}>Add Sender</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SenderCard({
  sender,
  onToggle,
  onDelete,
  onTest,
  isTesting,
}: {
  sender: EmailSender;
  onToggle: () => void;
  onDelete: () => void;
  onTest: () => void;
  isTesting: boolean;
}) {
  const usagePercent = sender.daily_limit > 0 ? (sender.sent_today / sender.daily_limit) * 100 : 0;
  const remaining = sender.daily_limit - sender.sent_today;

  return (
    <Card className={sender.is_active ? "" : "opacity-60"}>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <CardTitle className="truncate">{sender.name}</CardTitle>
              {sender.is_active ? (
                <Badge variant="default" className="bg-green-600">
                  Active
                </Badge>
              ) : (
                <Badge variant="secondary">Inactive</Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground truncate">{sender.email}</p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onTest} disabled={isTesting}>
                {isTesting ? (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                    Testing...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4 mr-2" />
                    Send Test
                  </>
                )}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onToggle}>
                {sender.is_active ? (
                  <>
                    <XCircle className="h-4 w-4 mr-2" />
                    Deactivate
                  </>
                ) : (
                  <>
                    <CheckCircle className="h-4 w-4 mr-2" />
                    Activate
                  </>
                )}
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive"
                onClick={onDelete}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Service Badge */}
          <div>
            <Badge variant="outline" className="text-xs">
              {sender.service.toUpperCase()}
            </Badge>
          </div>

          {/* Daily Usage */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground flex items-center gap-1">
                <Gauge className="h-4 w-4" />
                Daily Usage
              </span>
              <span>
                {sender.sent_today} / {sender.daily_limit}
              </span>
            </div>
            <Progress value={usagePercent} className="h-2" />
            <p className="text-xs text-muted-foreground">
              {remaining} emails remaining today
            </p>
          </div>

          {/* Last Reset */}
          {sender.last_reset_date && (
            <div className="text-xs text-muted-foreground">
              Last reset: {new Date(sender.last_reset_date).toLocaleDateString()}
            </div>
          )}

          {/* SMTP Details (if custom) */}
          {(sender.service === "smtp" || sender.service === "custom") && sender.smtp_host && (
            <div className="text-xs text-muted-foreground">
              {sender.smtp_host}:{sender.smtp_port}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
