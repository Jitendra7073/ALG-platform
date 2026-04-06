"use client";

import { useState, useEffect } from "react";
import { campaignsApi, templatesApi, type EmailCampaign, type EmailTemplate } from "@/lib/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  Plus,
  MoreHorizontal,
  Play,
  Trash2,
  Send,
  CheckCircle,
  XCircle,
  Clock,
  RefreshCw,
} from "lucide-react";

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<EmailCampaign[]>([]);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<EmailCampaign | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    template_id: 0,
    target_type: "all" as const,
    site_ids: [] as number[],
    contact_ids: [] as number[],
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [campaignsData, templatesData] = await Promise.all([
        campaignsApi.list(),
        templatesApi.list({ active: true }),
      ]);
      setCampaigns(campaignsData);
      setTemplates(templatesData);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load data");
    } finally {
      setIsLoading(false);
    }
  };

  const openCreateDialog = () => {
    setEditingCampaign(null);
    setFormData({
      name: "",
      template_id: 0,
      target_type: "all",
      site_ids: [],
      contact_ids: [],
    });
    setIsDialogOpen(true);
  };

  const openEditDialog = (campaign: EmailCampaign) => {
    setEditingCampaign(campaign);
    setFormData({
      name: campaign.name,
      template_id: campaign.template_id || 0,
      target_type: campaign.target_type,
      site_ids: [],
      contact_ids: [],
    });
    setIsDialogOpen(true);
  };

  const handleSubmit = async () => {
    try {
      if (editingCampaign) {
        await campaignsApi.update(editingCampaign.id, formData);
        toast.success("Campaign updated successfully");
      } else {
        await campaignsApi.create(formData);
        toast.success("Campaign created successfully");
      }
      setIsDialogOpen(false);
      loadData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save campaign");
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await campaignsApi.delete(id);
      toast.success("Campaign deleted successfully");
      loadData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete campaign");
    }
  };

  const handleStart = async (id: number) => {
    try {
      await campaignsApi.start(id, { send_immediately: true });
      toast.success("Campaign started successfully");
      loadData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to start campaign");
    }
  };

  const getStatusBadge = (status: EmailCampaign["status"]) => {
    switch (status) {
      case "running":
        return (
          <Badge className="gap-1 bg-green-600">
            <Play className="h-3 w-3" />
            Running
          </Badge>
        );
      case "queued":
        return (
          <Badge variant="secondary" className="gap-1">
            <Clock className="h-3 w-3" />
            Queued
          </Badge>
        );
      case "paused":
        return (
          <Badge variant="secondary" className="gap-1">
            <Clock className="h-3 w-3" />
            Paused
          </Badge>
        );
      case "completed":
        return (
          <Badge className="gap-1 bg-blue-600">
            <CheckCircle className="h-3 w-3" />
            Completed
          </Badge>
        );
      case "failed":
        return (
          <Badge variant="destructive" className="gap-1">
            <XCircle className="h-3 w-3" />
            Failed
          </Badge>
        );
      default:
        return (
          <Badge variant="outline">
            <Clock className="h-3 w-3" />
            Draft
          </Badge>
        );
    }
  };

  const getProgress = (campaign: EmailCampaign) => {
    const total = campaign.sent_count + campaign.failed_count;
    if (total === 0) return 0;
    return (campaign.sent_count / total) * 100;
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Campaigns</h2>
          <p className="text-muted-foreground">
            Manage email campaigns
          </p>
        </div>
        <Button onClick={openCreateDialog}>
          <Plus className="h-4 w-4 mr-2" />
          New Campaign
        </Button>
      </div>

      {/* Campaigns Grid */}
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-6 w-3/4" />
                <Skeleton className="h-4 w-1/2 mt-2" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-24 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : campaigns.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Send className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No campaigns yet</h3>
            <p className="text-muted-foreground mb-4">
              Create your first campaign to start sending emails
            </p>
            <Button onClick={openCreateDialog}>
              <Plus className="h-4 w-4 mr-2" />
              Create Campaign
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {campaigns.map((campaign) => (
            <CampaignCard
              key={campaign.id}
              campaign={campaign}
              template={templates.find((t) => t.id === campaign.template_id)}
              onEdit={() => openEditDialog(campaign)}
              onDelete={() => handleDelete(campaign.id)}
              onStart={() => handleStart(campaign.id)}
              getStatusBadge={getStatusBadge}
              getProgress={getProgress}
            />
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingCampaign ? "Edit Campaign" : "Create Campaign"}
            </DialogTitle>
            <DialogDescription>
              {editingCampaign
                ? "Update the campaign details"
                : "Create a new email campaign"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Campaign Name</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Q1 Outreach Campaign"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="template">Email Template (Optional)</Label>
              <Select
                value={formData.template_id.toString()}
                onValueChange={(v) => setFormData({ ...formData, template_id: parseInt(v) })}
              >
                <SelectTrigger id="template">
                  <SelectValue placeholder="Select a template" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">No template</SelectItem>
                  {templates.map((template) => (
                    <SelectItem key={template.id} value={template.id.toString()}>
                      {template.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="target_type">Target Type</Label>
              <Select
                value={formData.target_type}
                onValueChange={(v: any) => setFormData({ ...formData, target_type: v })}
              >
                <SelectTrigger id="target_type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Contacts</SelectItem>
                  <SelectItem value="wordpress">WordPress Sites</SelectItem>
                  <SelectItem value="ai_verified">AI Verified</SelectItem>
                  <SelectItem value="tagged">Tagged</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit}>
              {editingCampaign ? "Update" : "Create"} Campaign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CampaignCard({
  campaign,
  template,
  onEdit,
  onDelete,
  onStart,
  getStatusBadge,
  getProgress,
}: {
  campaign: EmailCampaign;
  template?: EmailTemplate;
  onEdit: () => void;
  onDelete: () => void;
  onStart: () => void;
  getStatusBadge: (status: EmailCampaign["status"]) => React.ReactNode;
  getProgress: (campaign: EmailCampaign) => number;
}) {
  const progress = getProgress(campaign);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <CardTitle className="truncate">{campaign.name}</CardTitle>
              {getStatusBadge(campaign.status)}
            </div>
            {template && (
              <p className="text-sm text-muted-foreground mt-1">
                Template: {template.name}
              </p>
            )}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Edit
              </DropdownMenuItem>
              {campaign.status === "draft" || campaign.status === "queued" ? (
                <DropdownMenuItem onClick={onStart}>
                  <Play className="h-4 w-4 mr-2" />
                  Start Campaign
                </DropdownMenuItem>
              ) : null}
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
          {/* Stats */}
          <div className="grid grid-cols-3 gap-2 text-center">
            <div>
              <p className="text-2xl font-bold">{campaign.total_recipients}</p>
              <p className="text-xs text-muted-foreground">Recipients</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-green-600">{campaign.sent_count}</p>
              <p className="text-xs text-muted-foreground">Sent</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-red-600">{campaign.failed_count}</p>
              <p className="text-xs text-muted-foreground">Failed</p>
            </div>
          </div>

          {/* Progress */}
          {campaign.sent_count > 0 || campaign.failed_count > 0 ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Progress</span>
                <span>{progress.toFixed(0)}%</span>
              </div>
              <Progress value={progress} />
            </div>
          ) : null}

          {/* Dates */}
          <div className="text-xs text-muted-foreground space-y-1">
            <div>Created: {new Date(campaign.created_at).toLocaleString()}</div>
            {campaign.started_at && (
              <div>Started: {new Date(campaign.started_at).toLocaleString()}</div>
            )}
            {campaign.completed_at && (
              <div>Completed: {new Date(campaign.completed_at).toLocaleString()}</div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
