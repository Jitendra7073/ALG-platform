"use client";

import * as React from "react";
import {
  Search,
  Users,
  Mail,
  Phone,
  ExternalLink,
  Filter,
  Trash2,
  X,
  Loader2,
  Send,
  FileText,
  AlertCircle,
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
  CardContent,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Contact {
  id: number;
  type: "email" | "phone" | "linkedin";
  value: string;
  site_url?: string;
  country?: string;
  source_page?: string;
  created_at: string;
}

interface Template {
  id: number;
  name: string;
  subject: string;
  category: string;
  description?: string;
  is_active: boolean;
  created_at: string;
}

type ContactType = "all" | "email" | "phone" | "linkedin";

export default function ContactsPage() {
  const [contacts, setContacts] = React.useState<Contact[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [meta, setMeta] = React.useState({
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 1,
  });
  const [activeTab, setActiveTab] = React.useState<ContactType>("all");
  const [selectedIds, setSelectedIds] = React.useState<Set<number>>(new Set());
  const [searchQuery, setSearchQuery] = React.useState("");
  const [bulkActionLoading, setBulkActionLoading] = React.useState(false);
  const [sendingEmails, setSendingEmails] = React.useState(false);

  // Template modal state
  const [showTemplateModal, setShowTemplateModal] = React.useState(false);
  const [templates, setTemplates] = React.useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] = React.useState<Template | null>(null);
  const [templatesLoading, setTemplatesLoading] = React.useState(false);
  const [templateError, setTemplateError] = React.useState<string | null>(null);

  const fetchContacts = async (page = 1, type: ContactType = "all") => {
    setLoading(true);
    try {
      const typeParam = type === "all" ? "" : `&type=${type}`;
      const searchParam = searchQuery
        ? `&search=${encodeURIComponent(searchQuery)}`
        : "";
      const res = await fetch(
        `/api/contacts?page=${page}&limit=20${typeParam}${searchParam}`,
      );
      const json = await res.json();
      if (json.success) {
        setContacts(json.data);
        setMeta(json.meta);
      } else {
        setError(json.error);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    fetchContacts(1, activeTab);
    setSelectedIds(new Set());
  }, [activeTab]);

  const handleSearch = () => {
    fetchContacts(1, activeTab);
  };

  const handleSelectAll = () => {
    if (selectedIds.size === contacts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(contacts.map((c) => c.id)));
    }
  };

  const handleSelectOne = (id: number) => {
    const newSelected = new Set(selectedIds);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedIds(newSelected);
  };

  const fetchTemplates = async () => {
    setTemplatesLoading(true);
    setTemplateError(null);
    try {
      const response = await fetch('/api/templates');
      const json = await response.json();

      if (json.success) {
        setTemplates(json.data);
        setShowTemplateModal(true);
      } else {
        setTemplateError(json.error || 'Failed to fetch templates');
        setShowTemplateModal(true);
      }
    } catch (err: any) {
      setTemplateError(err.message);
      setShowTemplateModal(true);
    } finally {
      setTemplatesLoading(false);
    }
  };

  const handleBulkAction = async (action: "queue" | "delete" | "cancel") => {
    if (selectedIds.size === 0) return;

    if (action === "queue") {
      // First fetch templates and show modal
      await fetchTemplates();
      return;
    }

    setBulkActionLoading(true);
    try {
      if (action === "delete") {
        // Delete selected contacts
        const deletePromises = Array.from(selectedIds).map(id =>
          fetch(`/api/contacts/${Number(id)}`, { method: 'DELETE' })
        );

        const results = await Promise.all(deletePromises);
        const allSuccessful = results.every(res => res.ok);

        if (allSuccessful) {
          alert(`✅ Successfully deleted ${selectedIds.size} contacts`);
          setSelectedIds(new Set());
          fetchContacts(meta.page, activeTab);
        } else {
          setError('Some contacts failed to delete');
        }
      } else if (action === "cancel") {
        // Just clear selection
        setSelectedIds(new Set());
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBulkActionLoading(false);
    }
  };

  const handleConfirmAddToQueue = async () => {
    if (!selectedTemplate) {
      alert('Please select a template first');
      return;
    }

    setShowTemplateModal(false);
    setBulkActionLoading(true);

    try {
      const response = await fetch('/api/contacts/add-to-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_ids: Array.from(selectedIds),
          template_id: selectedTemplate.id
        })
      });

      const json = await response.json();

      if (json.success) {
        alert(`✅ ${json.message}\n\nCampaign ID: ${json.data.campaign_id}\nQueued: ${json.data.total_queued} emails\nTemplate: ${selectedTemplate.name}`);
        setSelectedIds(new Set());
        setSelectedTemplate(null);
        fetchContacts(meta.page, activeTab);
      } else {
        setError(json.error || 'Failed to add contacts to queue');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBulkActionLoading(false);
    }
  };

  const handleSendEmails = async () => {
    if (!selectedTemplate) {
      alert('Please select a template first');
      return;
    }

    setShowTemplateModal(false);
    setBulkActionLoading(true);

    try {
      // First get an active sender from the database
      const senderResponse = await fetch('/api/email-senders?is_active=true');
      const senderJson = await senderResponse.json();

      if (!senderJson.success || !senderJson.data || senderJson.data.length === 0) {
        setError('No active email sender found. Please activate an email sender first.');
        return;
      }

      const sender = senderJson.data[0];

      // Send emails using the selected template and sender
      const response = await fetch('/api/contacts/send-emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_ids: Array.from(selectedIds),
          template_id: selectedTemplate.id,
          sender_id: sender.id
        })
      });

      const json = await response.json();

      if (json.success) {
        alert(`✅ ${json.message}\n\nSent: ${json.data.sent_count} emails\nFailed: ${json.data.failed_count || 0}\nTemplate: ${selectedTemplate.name}\nSender: ${sender.from_name || sender.from_email}`);
        setSelectedIds(new Set());
        setSelectedTemplate(null);
        fetchContacts(meta.page, activeTab);
      } else {
        setError(json.error || 'Failed to send emails');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBulkActionLoading(false);
    }
  };

  const handleDeleteContact = async (id: number) => {
    if (!confirm("Are you sure you want to delete this contact?")) return;

    try {
      const res = await fetch(`/api/contacts/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (json.success) {
        fetchContacts(meta.page, activeTab);
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleStartSending = async () => {
    setSendingEmails(true);
    try {
      const response = await fetch('/api/workers/process-queue', {
        method: 'GET'
      });

      const json = await response.json();

      if (json.success) {
        alert(`✅ Email processing completed!\n\nProcessed: ${json.processed} emails\nTime: ${json.processing_time_ms}ms\n\nResults: ${JSON.stringify(json.results, null, 2)}`);
      } else {
        setError(json.error || 'Failed to process email queue');
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSendingEmails(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {error && (
        <Card className="border-destructive">
          <CardContent className="p-4 flex items-center gap-3 text-destructive">
            <X className="h-5 w-5" />
            <p>{error}</p>
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h2 className="text-3xl font-bold tracking-tight">Contacts</h2>
          <p className="text-muted-foreground">
            Manage your prospects and leads
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-primary/70">Total Leads</p>
              <p className="text-2xl font-bold text-primary">{meta.total}</p>
            </div>
            <Users className="h-8 w-8 text-primary/20" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Emails
              </p>
              <p className="text-2xl font-bold">—</p>
            </div>
            <Mail className="h-8 w-8 text-muted-foreground opacity-20" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Phones
              </p>
              <p className="text-2xl font-bold">—</p>
            </div>
            <Phone className="h-8 w-8 text-muted-foreground opacity-20" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                LinkedIn
              </p>
              <p className="text-2xl font-bold">—</p>
            </div>
            <ExternalLink className="h-8 w-8 text-muted-foreground opacity-20" />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col md:flex-row md:items-center gap-4 justify-between border-b pb-4 -mx-6 px-6">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                className="w-full bg-muted/40 border border-input rounded-lg pl-10 pr-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="Search contacts..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              />
            </div>
            <div className="flex items-center gap-2">
              {selectedIds.size > 0 && (
                <>
                  <span className="text-sm text-muted-foreground">
                    {selectedIds.size} selected
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={() => handleBulkAction("queue")}
                    disabled={bulkActionLoading}>
                    {bulkActionLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Mail className="h-4 w-4" />
                    )}
                    Add to Queue
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2"
                    onClick={() => handleBulkAction("cancel")}
                    disabled={bulkActionLoading}>
                    <X className="h-4 w-4" />
                    Cancel
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2 text-destructive hover:text-destructive"
                    onClick={() => handleBulkAction("delete")}
                    disabled={bulkActionLoading}>
                    {bulkActionLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                    Delete
                  </Button>
                </>
              )}
              <Button
                variant="default"
                size="sm"
                className="gap-2 bg-green-600 hover:bg-green-700"
                onClick={handleStartSending}
                disabled={sendingEmails}>
                {sendingEmails ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                Start Sending
              </Button>
              <Button variant="outline" size="sm" className="gap-2">
                <Filter className="h-4 w-4" />
                Filter
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as ContactType)}>
            <TabsList className="mx-6 mt-4">
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="email">
                <Mail className="h-4 w-4 mr-1" />
                Email
              </TabsTrigger>
              <TabsTrigger value="phone">
                <Phone className="h-4 w-4 mr-1" />
                Phone
              </TabsTrigger>
              <TabsTrigger value="linkedin">
                <ExternalLink className="h-4 w-4 mr-1" />
                LinkedIn
              </TabsTrigger>
            </TabsList>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[50px]">
                    <Checkbox
                      checked={
                        contacts.length > 0 &&
                        selectedIds.size === contacts.length
                      }
                      onCheckedChange={handleSelectAll}
                    />
                  </TableHead>
                  <TableHead>Contact Info</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Source Website</TableHead>
                  <TableHead>Country</TableHead>
                  <TableHead>Added On</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  [...Array(6)].map((_, i) => (
                    <TableRow key={i}>
                      {[...Array(7)].map((_, j) => (
                        <TableCell key={j}>
                          <div className="h-8 bg-muted animate-pulse rounded" />
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : contacts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-64 text-center">
                      <div className="flex flex-col items-center gap-2 opacity-40">
                        <Users className="h-12 w-12" />
                        <p className="font-medium text-lg">No contacts found</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  contacts.map((contact) => (
                    <TableRow key={contact.id}>
                      <TableCell>
                        <Checkbox
                          checked={selectedIds.has(contact.id)}
                          onCheckedChange={() => handleSelectOne(contact.id)}
                        />
                      </TableCell>
                      <TableCell className="font-medium">
                        {contact.value}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <TypeIcon type={contact.type} />
                          <span className="capitalize text-xs">
                            {contact.type}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-muted-foreground text-xs">
                        {contact.site_url || "N/A"}
                      </TableCell>
                      <TableCell>
                        {contact.country ? (
                          <span className="bg-muted px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-tight">
                            {contact.country}
                          </span>
                        ) : (
                          "N/A"
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-xs">
                        {formatDate(contact.created_at)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => handleDeleteContact(contact.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Tabs>
        </CardContent>
        {meta.totalPages > 1 && (
          <div className="flex items-center justify-center p-4 border-t gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={meta.page <= 1}
              onClick={() => fetchContacts(meta.page - 1, activeTab)}>
              Previous
            </Button>
            <div className="text-xs font-medium px-4">
              Page {meta.page} of {meta.totalPages}
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={meta.page >= meta.totalPages}
              onClick={() => fetchContacts(meta.page + 1, activeTab)}>
              Next
            </Button>
          </div>
        )}
      </Card>

      {/* Template Selection Modal */}
      <Dialog open={showTemplateModal} onOpenChange={setShowTemplateModal}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Select Email Template</DialogTitle>
            <DialogDescription>
              Choose a template to use for sending emails to {selectedIds.size} selected contact(s)
            </DialogDescription>
          </DialogHeader>

          {templatesLoading ? (
            <div className="flex flex-col items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="mt-2 text-sm text-muted-foreground">Loading templates...</p>
            </div>
          ) : templateError ? (
            <div className="flex flex-col items-center justify-center py-8">
              <AlertCircle className="h-12 w-12 text-destructive mb-2" />
              <p className="text-lg font-semibold">Error Loading Templates</p>
              <p className="text-sm text-muted-foreground text-center mt-2">{templateError}</p>
            </div>
                  ) : templates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8">
              <FileText className="h-12 w-12 text-muted-foreground mb-2" />
              <p className="text-lg font-semibold">No Templates Found</p>
              <p className="text-sm text-muted-foreground text-center mt-2 max-w-md">
                Create templates locally and sync your changes to reflect here. All templates are fetched from the Supabase database.
              </p>
            </div>
          ) : (
            <div className="space-y-3 py-4">
              {templates.map((template) => (
                <div
                  key={template.id}
                  className={`border rounded-lg p-4 cursor-pointer transition-colors ${
                    selectedTemplate?.id === template.id
                      ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                      : 'border-border hover:border-primary/50 hover:bg-muted/50'
                  }`}
                  onClick={() => setSelectedTemplate(template)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{template.name}</h3>
                        {!template.is_active && (
                          <span className="text-xs bg-muted-foreground/20 text-muted-foreground px-2 py-0.5 rounded">
                            Inactive
                          </span>
                        )}
                        <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded capitalize">
                          {template.category}
                        </span>
                      </div>
                      <p className="text-sm font-medium mt-1">{template.subject}</p>
                      {template.description && (
                        <p className="text-sm text-muted-foreground mt-2">{template.description}</p>
                      )}
                      <p className="text-xs text-muted-foreground mt-2">
                        Created: {new Date(template.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="ml-4">
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                        selectedTemplate?.id === template.id
                          ? 'border-primary bg-primary'
                          : 'border-muted-foreground'
                      }`}>
                        {selectedTemplate?.id === template.id && (
                          <div className="w-2.5 h-2.5 rounded-full bg-white" />
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          <DialogFooter className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowTemplateModal(false);
                setSelectedTemplate(null);
              }}
              disabled={bulkActionLoading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirmAddToQueue}
              disabled={!selectedTemplate || bulkActionLoading || templates.length === 0}
              variant="outline"
              className="gap-2"
            >
              {bulkActionLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Adding to Queue...
                </>
              ) : (
                <>
                  <Mail className="h-4 w-4" />
                  Add to Queue
                </>
              )}
            </Button>
            {selectedTemplate && (
              <Button
                onClick={handleSendEmails}
                disabled={bulkActionLoading}
                className="gap-2 bg-green-600 hover:bg-green-700 text-white"
              >
                {bulkActionLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" />
                    Send Emails
                  </>
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TypeIcon({ type }: { type: string }) {
  if (type === "email") return <Mail className="h-3.5 w-3.5 text-blue-500" />;
  if (type === "phone")
    return <Phone className="h-3.5 w-3.5 text-emerald-500" />;
  if (type === "linkedin")
    return <ExternalLink className="h-3.5 w-3.5 text-sky-600" />;
  return null;
}
