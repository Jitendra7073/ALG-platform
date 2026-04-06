"use client";

import { useState, useEffect } from "react";
import { templatesApi, type EmailTemplate } from "@/lib/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import {
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
  FileText,
  Code,
  Tag,
  CheckCircle,
  XCircle,
} from "lucide-react";

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<EmailTemplate | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    subject: "",
    html_content: "",
    text_content: "",
    description: "",
    category: "general" as const,
    tags: "",
    is_active: true,
  });

  useEffect(() => {
    loadTemplates();
  }, []);

  const loadTemplates = async () => {
    setIsLoading(true);
    try {
      const data = await templatesApi.list();
      setTemplates(data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load templates");
    } finally {
      setIsLoading(false);
    }
  };

  const openCreateDialog = () => {
    setEditingTemplate(null);
    setFormData({
      name: "",
      subject: "",
      html_content: "",
      text_content: "",
      description: "",
      category: "general",
      tags: "",
      is_active: true,
    });
    setIsDialogOpen(true);
  };

  const openEditDialog = (template: EmailTemplate) => {
    setEditingTemplate(template);
    setFormData({
      name: template.name,
      subject: template.subject,
      html_content: template.html_content,
      text_content: template.text_content || "",
      description: template.description || "",
      category: template.category,
      tags: template.tags,
      is_active: template.is_active,
    });
    setIsDialogOpen(true);
  };

  const handleSubmit = async () => {
    try {
      if (editingTemplate) {
        await templatesApi.update(editingTemplate.id, {
          ...formData,
          is_active: formData.is_active,
        });
        toast.success("Template updated successfully");
      } else {
        await templatesApi.create(formData);
        toast.success("Template created successfully");
      }
      setIsDialogOpen(false);
      loadTemplates();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save template");
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await templatesApi.delete(id);
      toast.success("Template deleted successfully");
      loadTemplates();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete template");
    }
  };

  const handleToggleActive = async (template: EmailTemplate) => {
    try {
      await templatesApi.update(template.id, { is_active: !template.is_active });
      toast.success(`Template ${!template.is_active ? "activated" : "deactivated"}`);
      loadTemplates();
    } catch (error) {
      toast.error("Failed to toggle template status");
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Email Templates</h2>
          <p className="text-muted-foreground">
            Create and manage email templates
          </p>
        </div>
        <Button onClick={openCreateDialog}>
          <Plus className="h-4 w-4 mr-2" />
          New Template
        </Button>
      </div>

      {/* Templates Grid */}
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
      ) : templates.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No templates yet</h3>
            <p className="text-muted-foreground mb-4">
              Create your first email template to get started
            </p>
            <Button onClick={openCreateDialog}>
              <Plus className="h-4 w-4 mr-2" />
              Create Template
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {templates.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              onEdit={() => openEditDialog(template)}
              onDelete={() => handleDelete(template.id)}
              onToggle={() => handleToggleActive(template)}
            />
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <TemplateDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        template={editingTemplate}
        formData={formData}
        onChange={setFormData}
        onSubmit={handleSubmit}
      />
    </div>
  );
}

function TemplateCard({
  template,
  onEdit,
  onDelete,
  onToggle,
}: {
  template: EmailTemplate;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
}) {
  return (
    <Card className={template.is_active ? "" : "opacity-60"}>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div className="flex-1 min-w-0">
            <CardTitle className="truncate">{template.name}</CardTitle>
            <p className="text-sm text-muted-foreground truncate mt-1">
              {template.subject}
            </p>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}>
                <Pencil className="h-4 w-4 mr-2" />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onToggle}>
                {template.is_active ? (
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
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            {template.is_active ? (
              <Badge variant="default" className="bg-green-600">
                Active
              </Badge>
            ) : (
              <Badge variant="secondary">Inactive</Badge>
            )}
            <Badge variant="outline" className="capitalize">
              {template.category}
            </Badge>
            {template.sequence_number > 0 && (
              <Badge variant="outline" className="gap-1">
                #{template.sequence_number}
              </Badge>
            )}
            {template.tags && (
              <Badge variant="outline" className="gap-1">
                <Tag className="h-3 w-3" />
                {template.tags}
              </Badge>
            )}
          </div>
          {template.description && (
            <div className="text-sm text-muted-foreground line-clamp-2">
              {template.description}
            </div>
          )}
          <div className="text-xs text-muted-foreground">
            Created {new Date(template.created_at).toLocaleDateString()}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function TemplateDialog({
  open,
  onOpenChange,
  template,
  formData,
  onChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: EmailTemplate | null;
  formData: {
    name: string;
    subject: string;
    html_content: string;
    text_content: string;
    description: string;
    category: string;
    tags: string;
    is_active: boolean;
  };
  onChange: (data: typeof formData) => void;
  onSubmit: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {template ? "Edit Template" : "Create Template"}
          </DialogTitle>
          <DialogDescription>
            {template
              ? "Update the email template details"
              : "Create a new email template for your campaigns"}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="name">Template Name</Label>
            <Input
              id="name"
              value={formData.name}
              onChange={(e) => onChange({ ...formData, name: e.target.value })}
              placeholder="Welcome Email"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="category">Category</Label>
            <Select
              value={formData.category}
              onValueChange={(v) => onChange({ ...formData, category: v })}
            >
              <SelectTrigger id="category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="general">General</SelectItem>
                <SelectItem value="outreach">Outreach</SelectItem>
                <SelectItem value="welcome">Welcome</SelectItem>
                <SelectItem value="promotion">Promotion</SelectItem>
                <SelectItem value="followup">Follow-up</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="subject">Subject Line</Label>
            <Input
              id="subject"
              value={formData.subject}
              onChange={(e) => onChange({ ...formData, subject: e.target.value })}
              placeholder="Hello {{name}}!"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="html">Email Body (HTML)</Label>
            <Textarea
              id="html"
              value={formData.html_content}
              onChange={(e) => onChange({ ...formData, html_content: e.target.value })}
              placeholder="<p>Hi {{name}},</p><p>Check out our services...</p>"
              rows={10}
              className="font-mono text-sm"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="text">Plain Text Version (Optional)</Label>
            <Textarea
              id="text"
              value={formData.text_content}
              onChange={(e) => onChange({ ...formData, text_content: e.target.value })}
              placeholder="Hi {{name}}, check out our services..."
              rows={4}
              className="font-mono text-sm"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Input
              id="description"
              value={formData.description}
              onChange={(e) => onChange({ ...formData, description: e.target.value })}
              placeholder="Brief description of this template"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tags">Tags (comma-separated)</Label>
            <Input
              id="tags"
              value={formData.tags}
              onChange={(e) => onChange({ ...formData, tags: e.target.value })}
              placeholder="initial, followup, newsletter"
            />
          </div>

          <div className="flex items-center gap-2">
            <Switch
              id="is_active"
              checked={formData.is_active}
              onCheckedChange={(checked) => onChange({ ...formData, is_active: checked })}
            />
            <Label htmlFor="is_active">Active</Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onSubmit}>
            {template ? "Update" : "Create"} Template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
