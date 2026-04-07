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
  Clock,
  Calendar,
  CheckCircle2,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Info,
  Globe,
  AlertTriangle,
  Sparkles,
  TrendingUp,
  XCircle,
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
  site_id?: number;
  site_url?: string;
  country?: string;
  source_page?: string;
  created_at: string;
}

interface Site {
  id: number;
  url: string;
  country: string;
}

interface ContactWithCountry extends Contact {
  countryInfo?: CountryTimezone;
  countryName?: string;
  businessHoursStatus?: 'within_hours' | 'outside_hours' | 'weekend';
  nextBusinessHours?: Date;
}

interface Sequence {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  items: SequenceItem[];
  created_at: string;
}

interface SequenceItem {
  id: string;
  template_id: string;
  template_name: string;
  template_subject: string;
  position: number;
  delay_days: number | null;
  delay_hours: number | null;
  send_time?: string;
}

interface CountryTimezone {
  id: string;
  country_code: string;
  country_name: string;
  default_timezone: string;
  business_hours_start: string;
  business_hours_end: string;
  weekend_days: string[];
  region?: string;
}

interface QueuedEmail {
  contact_id: number;
  contact_email: string;
  template_id: string;
  template_name: string;
  template_subject: string;
  position: number;
  scheduled_at: Date;
  status: 'ready' | 'weekend' | 'outside_hours';
  reason?: string;
}

type ContactType = "all" | "email" | "phone" | "linkedin";
type DeliveryOption = 'immediate' | 'next_business_hours' | 'custom';

type WizardStep = 'contacts' | 'sequence' | 'validate' | 'review' | 'confirm';

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
  const [activeTab, setActiveTab] = React.useState<ContactType>("email");
  const [selectedIds, setSelectedIds] = React.useState<Set<number>>(new Set());
  const [searchQuery, setSearchQuery] = React.useState("");
  const [bulkActionLoading, setBulkActionLoading] = React.useState(false);
  const [sendingEmails, setSendingEmails] = React.useState(false);

  // Sequence modal state
  const [showSequenceModal, setShowSequenceModal] = React.useState(false);
  const [sequences, setSequences] = React.useState<Sequence[]>([]);
  const [selectedSequence, setSelectedSequence] = React.useState<Sequence | null>(null);
  const [sequencesLoading, setSequencesLoading] = React.useState(false);
  const [sequenceError, setSequenceError] = React.useState<string | null>(null);

  // Wizard state
  const [showWizard, setShowWizard] = React.useState(false);
  const [wizardStep, setWizardStep] = React.useState<WizardStep>('contacts');
  const [wizardContacts, setWizardContacts] = React.useState<ContactWithCountry[]>([]);
  const [wizardLoading, setWizardLoading] = React.useState(false);
  const [selectedSequenceForWizard, setSelectedSequenceForWizard] = React.useState<Sequence | null>(null);
  const [queuedEmails, setQueuedEmails] = React.useState<QueuedEmail[]>([]);
  const [deliveryOption, setDeliveryOption] = React.useState<DeliveryOption>('immediate');
  const [customDateTime, setCustomDateTime] = React.useState<string>('');
  const [countryTimezones, setCountryTimezones] = React.useState<Record<string, CountryTimezone>>({});
  const [businessHoursWarnings, setBusinessHoursWarnings] = React.useState<string[]>([]);

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

  // Wizard functions
  const loadContactsWithCountry = async () => {
    setWizardLoading(true);
    try {
      // Get country timezones
      const countriesRes = await fetch('/api/countries');
      const countriesJson = await countriesRes.json();
      if (countriesJson.success) {
        const timezoneMap: Record<string, CountryTimezone> = {};
        countriesJson.data.forEach((c: CountryTimezone) => {
          timezoneMap[c.country_code] = c;
        });
        setCountryTimezones(timezoneMap);
      }

      // Get contacts with their site country
      const selectedContacts = contacts.filter(c => selectedIds.has(c.id));
      const enrichedContacts: ContactWithCountry[] = selectedContacts.map(contact => {
        const countryInfo = contact.country ? timezoneMap[contact.country] : undefined;
        return {
          ...contact,
          countryInfo,
          countryName: countryInfo?.country_name,
          businessHoursStatus: undefined,
          nextBusinessHours: undefined
        };
      });

      setWizardContacts(enrichedContacts);
    } catch (err: any) {
      console.error('Error loading contacts:', err);
    } finally {
      setWizardLoading(false);
    }
  };

  const validateBusinessHours = () => {
    const now = new Date();
    const warnings: string[] = [];
    const updatedContacts = [...wizardContacts];

    updatedContacts.forEach(contact => {
      if (!contact.countryInfo) return;

      const info = contact.countryInfo;
      const countryTime = now.toLocaleString('en-US', { timeZone: info.default_timezone });
      const countryDate = new Date(countryTime);

      // Check if weekend
      const dayName = countryDate.toLocaleString('en-US', { weekday: 'long' });
      const isWeekend = info.weekend_days.includes(dayName);

      if (isWeekend) {
        contact.businessHoursStatus = 'weekend';
        warnings.push(`${contact.value} (${contact.countryName}) is in weekend`);
      } else {
        // Check business hours
        const [hours, minutes] = info.business_hours_start.split(':').map(Number);
        const [endHours, endMinutes] = info.business_hours_end.split(':').map(Number);
        const currentHour = countryDate.getHours();
        const currentMinute = countryDate.getMinutes();

        const isWithinHours = currentHour >= hours && currentHour < endHours;

        if (!isWithinHours) {
          contact.businessHoursStatus = 'outside_hours';
          // Calculate next business hours
          const nextStart = new Date(countryDate);
          if (currentHour < hours) {
            nextStart.setHours(hours, minutes, 0, 0);
          } else {
            nextStart.setDate(nextStart.getDate() + 1);
            nextStart.setHours(hours, minutes, 0, 0);
          }
          contact.nextBusinessHours = nextStart;
          warnings.push(`${contact.value} (${contact.countryName}) is outside business hours (${currentHour}:${currentMinute.toString().padStart(2, '0')} local time)`);
        } else {
          contact.businessHoursStatus = 'within_hours';
        }
      }
    });

    setWizardContacts(updatedContacts);
    setBusinessHoursWarnings(warnings);
  };

  const calculateScheduledEmails = (): QueuedEmail[] => {
    const emails: QueuedEmail[] = [];
    const now = new Date();

    if (!selectedSequenceForWizard) return emails;

    selectedSequenceForWizard.items.forEach(item => {
      wizardContacts.forEach(contact => {
        if (contact.type !== 'email') return;

        let scheduledAt = new Date(now);
        let status: QueuedEmail['status'] = 'ready';
        let reason = '';

        // Add delay days
        if (item.delay_days) {
          scheduledAt.setDate(scheduledAt.getDate() + item.delay_days);
        }
        if (item.delay_hours) {
          scheduledAt.setHours(scheduledAt.getHours() + item.delay_hours);
        }

        // Apply delivery option
        if (deliveryOption === 'next_business_hours') {
          if (contact.businessHoursStatus === 'outside_hours' && contact.nextBusinessHours) {
            scheduledAt = contact.nextBusinessHours;
          } else if (contact.businessHoursStatus === 'weekend') {
            // Move to Monday
            while (scheduledAt.toLocaleString('en-US', { weekday: 'long' }) !== 'Monday') {
              scheduledAt.setDate(scheduledAt.getDate() + 1);
            }
            // Set to business hours
            if (contact.countryInfo) {
              const [hours] = contact.countryInfo.business_hours_start.split(':').map(Number);
              scheduledAt.setHours(hours, 0, 0, 0);
            }
          }
        } else if (deliveryOption === 'custom' && customDateTime) {
          scheduledAt = new Date(customDateTime);
        }

        // Skip weekends if configured
        if (contact.countryInfo) {
          const dayName = scheduledAt.toLocaleString('en-US', { weekday: 'long' });
          if (contact.countryInfo.weekend_days.includes(dayName)) {
            // Move to next business day (Monday)
            while (scheduledAt.toLocaleString('en-US', { weekday: 'long' }) !== 'Monday') {
              scheduledAt.setDate(scheduledAt.getDate() + 1);
            }
          }
        }

        emails.push({
          contact_id: contact.id,
          contact_email: contact.value,
          template_id: item.template_id,
          template_name: item.template_name || `Template ${item.position}`,
          template_subject: item.template_subject || 'No subject',
          position: item.position,
          scheduled_at: scheduledAt,
          status,
          reason
        });
      });
    });

    return emails;
  };

  const handleWizardNext = () => {
    if (wizardStep === 'contacts') {
      setWizardStep('sequence');
    } else if (wizardStep === 'sequence') {
      validateBusinessHours();
      setWizardStep('validate');
    } else if (wizardStep === 'validate') {
      const emails = calculateScheduledEmails();
      setQueuedEmails(emails);
      setWizardStep('review');
    } else if (wizardStep === 'review') {
      submitToQueue();
    }
  };

  const handleWizardBack = () => {
    if (wizardStep === 'sequence') setWizardStep('contacts');
    else if (wizardStep === 'validate') setWizardStep('sequence');
    else if (wizardStep === 'review') setWizardStep('validate');
  };

  const submitToQueue = async () => {
    setWizardLoading(true);
    try {
      const response = await fetch('/api/queue/schedule-sequence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sequence_id: selectedSequenceForWizard?.id,
          emails: queuedEmails,
          delivery_option: deliveryOption,
          custom_date_time: customDateTime
        })
      });

      const json = await response.json();

      if (json.success) {
        setShowWizard(false);
        alert(`✅ Successfully queued ${queuedEmails.length} emails for ${wizardContacts.length} contacts`);
        setSelectedIds(new Set());
        fetchContacts(meta.page, activeTab);
      } else {
        alert(json.error || 'Failed to queue emails');
      }
    } catch (err: any) {
      alert('Error: ' + err.message);
    } finally {
      setWizardLoading(false);
    }
  };

  const fetchSequences = async () => {
    setSequencesLoading(true);
    setSequenceError(null);
    try {
      const response = await fetch('/api/sequences');
      const json = await response.json();

      if (json.success) {
        setSequences(json.data);
        setShowSequenceModal(true);
      } else {
        setSequenceError(json.error || 'Failed to fetch sequences');
        setShowSequenceModal(true);
      }
    } catch (err: any) {
      setSequenceError(err.message);
      setShowSequenceModal(true);
    } finally {
      setSequencesLoading(false);
    }
  };

  const handleBulkAction = async (action: "queue" | "delete" | "cancel") => {
    if (selectedIds.size === 0) return;

    if (action === "queue") {
      // Start the wizard
      setShowWizard(true);
      setWizardStep('contacts');
      setQueuedEmails([]);
      setDeliveryOption('immediate');
      setCustomDateTime('');
      setBusinessHoursWarnings([]);

      // Fetch contacts with country info
      await loadContactsWithCountry();
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
    if (!selectedSequence) {
      alert('Please select a sequence first');
      return;
    }

    setShowSequenceModal(false);
    setBulkActionLoading(true);

    try {
      const response = await fetch('/api/contacts/add-to-queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_ids: Array.from(selectedIds),
          sequence_id: selectedSequence.id
        })
      });

      const json = await response.json();

      if (json.success) {
        const itemCount = selectedSequence.items?.length || 0;
        alert(`✅ ${json.message}\n\nCampaign ID: ${json.data.campaign_id}\nQueued: ${json.data.total_queued} emails\nSequence: ${selectedSequence.name}\nEmails per contact: ${itemCount}`);
        setSelectedIds(new Set());
        setSelectedSequence(null);
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
    if (!selectedSequence) {
      alert('Please select a sequence first');
      return;
    }

    setShowSequenceModal(false);
    setBulkActionLoading(true);

    try {
      // First get an active sender from the database
      const senderResponse = await fetch('/api/senders?is_active=true');
      const senderJson = await senderResponse.json();

      if (!senderJson.success || !senderJson.data || senderJson.data.length === 0) {
        setError('No active email sender found. Please activate an email sender first.');
        return;
      }

      const sender = senderJson.data[0];

      // Send emails using the selected sequence (first template)
      const response = await fetch('/api/contacts/send-emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_ids: Array.from(selectedIds),
          sequence_id: selectedSequence.id,
          sender_id: sender.id
        })
      });

      const json = await response.json();

      if (json.success) {
        alert(`✅ ${json.message}\n\nSent: ${json.data.sent_count} emails\nFailed: ${json.data.failed_count || 0}\nSequence: ${selectedSequence.name}\nSender: ${sender.from_name || sender.from_email}`);
        setSelectedIds(new Set());
        setSelectedSequence(null);
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

      {/* Sequence Selection Modal */}
      <Dialog open={showSequenceModal} onOpenChange={setShowSequenceModal}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Select Email Sequence</DialogTitle>
            <DialogDescription>
              Choose a sequence to add {selectedIds.size} selected contact(s) to the queue
            </DialogDescription>
          </DialogHeader>

          {sequencesLoading ? (
            <div className="flex flex-col items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="mt-2 text-sm text-muted-foreground">Loading sequences...</p>
            </div>
          ) : sequenceError ? (
            <div className="flex flex-col items-center justify-center py-8">
              <AlertCircle className="h-12 w-12 text-destructive mb-2" />
              <p className="text-lg font-semibold">Error Loading Sequences</p>
              <p className="text-sm text-muted-foreground text-center mt-2">{sequenceError}</p>
            </div>
          ) : sequences.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8">
              <Mail className="h-12 w-12 text-muted-foreground mb-2" />
              <p className="text-lg font-semibold">No Sequences Found</p>
              <p className="text-sm text-muted-foreground text-center mt-2 max-w-md">
                Create sequences first to add contacts to email queues. Go to the Sequences page to create one.
              </p>
            </div>
          ) : (
            <div className="space-y-3 py-4">
              {sequences.map((sequence) => (
                <div
                  key={sequence.id}
                  className={`border rounded-lg p-4 cursor-pointer transition-colors ${
                    selectedSequence?.id === sequence.id
                      ? 'border-primary bg-primary/5 ring-2 ring-primary/20'
                      : 'border-border hover:border-primary/50 hover:bg-muted/50'
                  }`}
                  onClick={() => setSelectedSequence(sequence)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold">{sequence.name}</h3>
                        {!sequence.is_active && (
                          <span className="text-xs bg-muted-foreground/20 text-muted-foreground px-2 py-0.5 rounded">
                            Inactive
                          </span>
                        )}
                        <span className="text-xs bg-blue-500/10 text-blue-500 px-2 py-0.5 rounded">
                          {sequence.items?.length || 0} emails
                        </span>
                      </div>
                      {sequence.description && (
                        <p className="text-sm text-muted-foreground mt-1">{sequence.description}</p>
                      )}
                      {sequence.items && sequence.items.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {sequence.items.slice(0, 4).map((item, idx) => (
                            <span key={item.id} className="text-xs bg-muted px-2 py-1 rounded">
                              {idx + 1}. {item.template_name || 'Unknown'}
                              {item.delay_days && ` (+${item.delay_days}d)`}
                            </span>
                          ))}
                          {sequence.items.length > 4 && (
                            <span className="text-xs text-muted-foreground">
                              +{sequence.items.length - 4} more
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="ml-4">
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                        selectedSequence?.id === sequence.id
                          ? 'border-primary bg-primary'
                          : 'border-muted-foreground'
                      }`}>
                        {selectedSequence?.id === sequence.id && (
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
                setShowSequenceModal(false);
                setSelectedSequence(null);
              }}
              disabled={bulkActionLoading}
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirmAddToQueue}
              disabled={!selectedSequence || bulkActionLoading || sequences.length === 0}
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
            {selectedSequence && (
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

      {/* Sequence Wizard Modal */}
      <Dialog open={showWizard} onOpenChange={setShowWizard}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {wizardStep === 'contacts' && 'Step 1: Selected Contacts'}
              {wizardStep === 'sequence' && 'Step 2: Select Sequence'}
              {wizardStep === 'validate' && 'Step 3: Validate Business Hours'}
              {wizardStep === 'review' && 'Step 4: Review & Confirm'}
              {wizardStep === 'confirm' && 'Confirming...'}
            </DialogTitle>
            <DialogDescription>
              {wizardStep === 'contacts' && `Managing ${selectedIds.size} selected contact(s)`}
              {wizardStep === 'sequence' && 'Choose an email sequence to send'}
              {wizardStep === 'validate' && 'Check business hours and delivery timing'}
              {wizardStep === 'review' && `Review ${queuedEmails.length} queued emails before confirming`}
            </DialogDescription>
          </DialogHeader>

          {/* Step 1: Contacts */}
          {wizardStep === 'contacts' && (
            <div className="space-y-4 py-4">
              {wizardLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin" />
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="text-sm text-muted-foreground">
                    {wizardContacts.length} email contacts ready to process
                  </div>
                  {wizardContacts.map((contact) => (
                    <div key={contact.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div className="flex items-center gap-3">
                        <Mail className="h-4 w-4 text-blue-500" />
                        <div>
                          <div className="text-sm font-medium">{contact.value}</div>
                          <div className="text-xs text-muted-foreground">
                            {contact.country || 'Unknown Region'}
                          </div>
                        </div>
                      </div>
                      {contact.countryName && (
                        <span className="text-xs bg-muted px-2 py-1 rounded">
                          {contact.countryName}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setShowWizard(false)}>Cancel</Button>
                <Button onClick={handleWizardNext} disabled={wizardContacts.length === 0}>
                  Next <ChevronRight className="h-4 w-4 ml-2" />
                </Button>
              </DialogFooter>
            </div>
          )}

          {/* Step 2: Select Sequence */}
          {wizardStep === 'sequence' && (
            <div className="space-y-4 py-4">
              {sequencesLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin" />
                </div>
              ) : (
                <div className="space-y-3">
                  {sequences.map((sequence) => (
                    <div
                      key={sequence.id}
                      className={`border rounded-lg p-4 cursor-pointer transition-colors ${
                        selectedSequenceForWizard?.id === sequence.id
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-primary/50'
                      }`}
                      onClick={() => setSelectedSequenceForWizard(sequence)}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="font-semibold">{sequence.name}</h3>
                          {sequence.description && (
                            <p className="text-sm text-muted-foreground mt-1">{sequence.description}</p>
                          )}
                          <div className="flex items-center gap-2 mt-2">
                            <span className="text-xs bg-blue-500/10 text-blue-500 px-2 py-1 rounded">
                              {sequence.items?.length || 0} emails
                            </span>
                            {sequence.items?.slice(0, 3).map((item, idx) => (
                              <span key={item.id} className="text-xs bg-muted px-2 py-1 rounded">
                                {idx + 1}. {item.template_name}
                                {item.delay_days && ` (+${item.delay_days}d)`}
                              </span>
                            ))}
                          </div>
                        </div>
                        {selectedSequenceForWizard?.id === sequence.id && (
                          <CheckCircle2 className="h-5 w-5 text-primary" />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={handleWizardBack}>Back</Button>
                <Button onClick={handleWizardNext} disabled={!selectedSequenceForWizard}>
                  Next <ChevronRight className="h-4 w-4 ml-2" />
                </Button>
              </DialogFooter>
            </div>
          )}

          {/* Step 3: Validate Business Hours */}
          {wizardStep === 'validate' && (
            <div className="space-y-4 py-4">
              <div className="bg-muted/50 p-4 rounded-lg">
                <div className="flex items-center gap-2 mb-3">
                  <Info className="h-4 w-4 text-blue-500" />
                  <h3 className="font-semibold text-sm">Business Hours Validation</h3>
                </div>
                <p className="text-sm text-muted-foreground mb-4">
                  Checking business hours for each contact based on their country timezone...
                </p>

                {businessHoursWarnings.length > 0 && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2 text-amber-600">
                      <AlertTriangle className="h-4 w-4" />
                      <span className="text-sm font-medium">Some contacts are outside business hours</span>
                    </div>
                    <div className="space-y-1">
                      {businessHoursWarnings.map((warning, idx) => (
                        <div key={idx} className="text-xs text-muted-foreground bg-background p-2 rounded">
                          {warning}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Delivery Options */}
              <div className="space-y-3">
                <h4 className="text-sm font-medium">Delivery Options</h4>
                <div className="grid grid-cols-3 gap-3">
                  <button
                    className={`p-3 border rounded-lg text-left transition-colors ${
                      deliveryOption === 'immediate'
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:bg-muted'
                    }`}
                    onClick={() => setDeliveryOption('immediate')}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Send className="h-4 w-4 text-primary" />
                      <span className="text-sm font-medium">Immediate</span>
                    </div>
                    <p className="text-xs text-muted-foreground">Send immediately if within hours</p>
                  </button>

                  <button
                    className={`p-3 border rounded-lg text-left transition-colors ${
                      deliveryOption === 'next_business_hours'
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:bg-muted'
                    }`}
                    onClick={() => setDeliveryOption('next_business_hours')}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Clock className="h-4 w-4 text-primary" />
                      <span className="text-sm font-medium">Next Business Hours</span>
                    </div>
                    <p className="text-xs text-muted-foreground">Wait until business hours start</p>
                  </button>

                  <button
                    className={`p-3 border rounded-lg text-left transition-colors ${
                      deliveryOption === 'custom'
                        ? 'border-primary bg-primary/5'
                        : 'border-border hover:bg-muted'
                    }`}
                    onClick={() => setDeliveryOption('custom')}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Calendar className="h-4 w-4 text-primary" />
                      <span className="text-sm font-medium">Custom Date/Time</span>
                    </div>
                    <p className="text-xs text-muted-foreground">Choose specific date and time</p>
                  </button>
                </div>

                {deliveryOption === 'custom' && (
                  <input
                    type="datetime-local"
                    className="w-full px-3 py-2 border rounded-lg"
                    value={customDateTime}
                    onChange={(e) => setCustomDateTime(e.target.value)}
                  />
                )}
              </div>

              {/* Contacts Status */}
              <div className="space-y-2">
                <h4 className="text-sm font-medium">Contact Status</h4>
                <div className="space-y-1 max-h-40 overflow-y-auto">
                  {wizardContacts.map((contact) => (
                    <div key={contact.id} className="flex items-center justify-between p-2 border rounded text-sm">
                      <div className="flex items-center gap-2">
                        <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                        <span>{contact.value}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {contact.countryName && (
                          <span className="text-xs bg-muted px-2 py-0.5 rounded">{contact.countryName}</span>
                        )}
                        {contact.businessHoursStatus === 'within_hours' && (
                          <span className="text-xs bg-emerald-500/10 text-emerald-600 px-2 py-0.5 rounded">Within Hours</span>
                        )}
                        {contact.businessHoursStatus === 'outside_hours' && (
                          <span className="text-xs bg-amber-500/10 text-amber-600 px-2 py-0.5 rounded">Outside Hours</span>
                        )}
                        {contact.businessHoursStatus === 'weekend' && (
                          <span className="text-xs bg-orange-500/10 text-orange-600 px-2 py-0.5 rounded">Weekend</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={handleWizardBack}>Back</Button>
                <Button onClick={handleWizardNext}>
                  Review <ChevronRight className="h-4 w-4 ml-2" />
                </Button>
              </DialogFooter>
            </div>
          )}

          {/* Step 4: Review */}
          {wizardStep === 'review' && (
            <div className="space-y-4 py-4">
              <div className="bg-muted/50 p-4 rounded-lg">
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles className="h-4 w-4 text-primary" />
                  <h3 className="font-semibold text-sm">Review Schedule</h3>
                </div>
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Sequence</p>
                    <p className="font-medium">{selectedSequenceForWizard?.name}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Total Emails</p>
                    <p className="font-medium">{queuedEmails.length}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Contacts</p>
                    <p className="font-medium">{wizardContacts.length}</p>
                  </div>
                </div>
                <div className="mt-2 text-sm">
                  <p className="text-muted-foreground">Delivery: <span className="font-medium text-foreground">
                    {deliveryOption === 'immediate' ? 'Immediate (if within hours)' : deliveryOption === 'next_business_hours' ? 'Next Business Hours' : 'Custom Date/Time'}
                  </span></p>
                </div>
              </div>

              {/* Timeline Preview */}
              <div className="max-h-80 overflow-y-auto space-y-3">
                <h4 className="text-sm font-medium flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" />
                  Schedule Timeline
                </h4>

                {/* Group emails by contact */}
                {(() => {
                  const groupedByEmail = new Map<string, typeof queuedEmails>();
                  queuedEmails.forEach(email => {
                    if (!groupedByEmail.has(email.contact_email)) {
                      groupedByEmail.set(email.contact_email, []);
                    }
                    groupedByEmail.get(email.contact_email)!.push(email);
                  });

                  // Sort each group by position
                  for (const emails of groupedByEmail.values()) {
                    emails.sort((a, b) => a.position - b.position);
                  }

                  return Array.from(groupedByEmail.entries()).map(([email, emails]) => {
                    const sentCount = emails.filter(e => e.status === 'ready').length;
                    const totalCount = emails.length;

                    return (
                      <div key={email} className="border rounded-lg bg-background overflow-hidden">
                        <div className="p-3 bg-muted/30 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <Mail className="h-4 w-4 text-primary" />
                            <span className="font-medium text-sm">{email}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">{sentCount}/{totalCount} emails</span>
                            <div className="h-1.5 w-20 bg-muted rounded-full overflow-hidden">
                              <div
                                className="h-full bg-primary transition-all"
                                style={{ width: `${totalCount > 0 ? (sentCount / totalCount) * 100 : 0}%` }}
                              />
                            </div>
                          </div>
                        </div>

                        {/* Timeline */}
                        <div className="p-3">
                          <div className="relative">
                            {emails.map((emailItem, idx) => {
                              const isLast = idx === emails.length - 1;
                              const scheduleDate = emailItem.scheduled_at;
                              const now = new Date();
                              const isPast = scheduleDate < now;

                              return (
                                <div key={`${emailItem.contact_id}-${emailItem.position}`} className="relative flex gap-3 pb-3 last:pb-0">
                                  {/* Timeline dot */}
                                  <div className="relative z-10 flex flex-col items-center">
                                    {emailItem.status === 'ready' ? (
                                      <div className="h-6 w-6 rounded-full bg-emerald-500 flex items-center justify-center">
                                        <CheckCircle2 className="h-3 w-3 text-white" />
                                      </div>
                                    ) : emailItem.status === 'weekend' ? (
                                      <div className="h-6 w-6 rounded-full bg-orange-500 flex items-center justify-center">
                                        <AlertCircle className="h-3 w-3 text-white" />
                                      </div>
                                    ) : (
                                      <div className="h-6 w-6 rounded-full bg-blue-500 flex items-center justify-center">
                                        <Clock className="h-3 w-3 text-white" />
                                      </div>
                                    )}
                                    {!isLast && <div className="w-0.5 h-full bg-border min-h-6" />}
                                  </div>

                                  {/* Email content */}
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                          <span className="text-xs font-medium text-muted-foreground">
                                            Email {emailItem.position}
                                          </span>
                                          {emailItem.status === 'ready' && (
                                            <span className="bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 px-1.5 py-0.5 rounded text-xs">Ready</span>
                                          )}
                                          {emailItem.status === 'weekend' && (
                                            <span className="bg-orange-500/10 text-orange-600 border border-orange-500/20 px-1.5 py-0.5 rounded text-xs">Weekend</span>
                                          )}
                                          {emailItem.status === 'outside_hours' && (
                                            <span className="bg-amber-500/10 text-amber-600 border border-amber-500/20 px-1.5 py-0.5 rounded text-xs">Outside Hours</span>
                                          )}
                                        </div>
                                        <p className="text-sm font-medium truncate">{emailItem.template_subject}</p>
                                        {emailItem.reason && (
                                          <p className="text-xs text-muted-foreground">{emailItem.reason}</p>
                                        )}
                                      </div>
                                      <div className="text-right shrink-0">
                                        <p className="text-xs text-muted-foreground">Scheduled</p>
                                        <p className="text-sm font-medium">
                                          {scheduleDate.toLocaleDateString() === now.toLocaleDateString()
                                            ? `Today ${scheduleDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                                            : scheduleDate.toLocaleDateString()}
                                        </p>
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={handleWizardBack}>Back</Button>
                <Button onClick={handleWizardNext} disabled={wizardLoading}>
                  {wizardLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirm & Queue All Emails'}
                </Button>
              </DialogFooter>
            </div>
          )}
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
