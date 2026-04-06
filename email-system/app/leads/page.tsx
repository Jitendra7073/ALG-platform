"use client";

import { useState } from "react";
import { usePolling } from "@/lib/hooks/use-polling";
import { leadsApi, type Lead, type LeadsQuery } from "@/lib/api/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Search,
  RefreshCw,
  Globe,
  Mail,
  Phone,
  Linkedin,
  ExternalLink,
} from "lucide-react";

export default function LeadsPage() {
  const [query, setQuery] = useState<LeadsQuery>({
    page: 1,
    limit: 20,
  });
  const [searchInput, setSearchInput] = useState("");

  const { data: response, isLoading, error, refetch } = usePolling({
    fn: () => leadsApi.list(query),
    interval: 15000,
  });

  const leads = response?.items ?? [];
  const total = response?.pagination?.total ?? 0;
  const limit = response?.pagination?.limit ?? 20;
  const totalPages = Math.ceil(total / limit);

  const handleSearch = () => {
    setQuery((prev) => ({ ...prev, page: 1, tag: searchInput || undefined }));
  };

  const handleFilter = (key: keyof LeadsQuery, value: string | boolean | undefined) => {
    setQuery((prev) => ({ ...prev, page: 1, [key]: value }));
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Leads</h2>
          <p className="text-muted-foreground">
            WordPress sites with contact information
          </p>
        </div>
        <Button onClick={refetch} variant="outline" size="icon">
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* Filters Card */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row gap-4">
            {/* Search by Tag */}
            <div className="flex-1 flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by tag..."
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  className="pl-9"
                />
              </div>
              <Button onClick={handleSearch}>Search</Button>
            </div>

            {/* Filters */}
            <div className="flex gap-2 flex-wrap">
              <Select
                value={query.country ?? "all"}
                onValueChange={(v) => handleFilter("country", v === "all" ? undefined : v)}
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="Country" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Countries</SelectItem>
                  <SelectItem value="in">India</SelectItem>
                  <SelectItem value="us">United States</SelectItem>
                  <SelectItem value="uk">United Kingdom</SelectItem>
                  <SelectItem value="au">Australia</SelectItem>
                  <SelectItem value="ca">Canada</SelectItem>
                  <SelectItem value="de">Germany</SelectItem>
                </SelectContent>
              </Select>

              <Select
                value={query.relevant_only ? "true" : "false"}
                onValueChange={(v) => handleFilter("relevant_only", v === "true")}
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue placeholder="AI Verified" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="false">All Leads</SelectItem>
                  <SelectItem value="true">AI Verified Only</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Results</span>
            <span className="text-sm font-normal text-muted-foreground">
              {total} total leads
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading && leads.length === 0 ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : error ? (
            <div className="text-center py-8 text-muted-foreground">
              Error loading leads
            </div>
          ) : leads.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No leads found. Try adjusting your filters.
            </div>
          ) : (
            <>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Site</TableHead>
                      <TableHead>Country</TableHead>
                      <TableHead>Contacts</TableHead>
                      <TableHead>Email Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {leads.map((lead) => (
                      <TableRow key={lead.id}>
                        <TableCell>
                          <div className="max-w-[300px]">
                            <div className="flex items-center gap-2">
                              <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
                              <a
                                href={lead.site_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-medium truncate hover:underline flex items-center gap-1"
                              >
                                {lead.site_url}
                                <ExternalLink className="h-3 w-3 shrink-0" />
                              </a>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {lead.site_country.toUpperCase()}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            {lead.total_emails > 0 ? (
                              <Badge variant="secondary" className="gap-1">
                                <Mail className="h-3 w-3" />
                                {lead.total_emails}
                              </Badge>
                            ) : null}
                            {lead.total_phones > 0 ? (
                              <Badge variant="secondary" className="gap-1">
                                <Phone className="h-3 w-3" />
                                {lead.total_phones}
                              </Badge>
                            ) : null}
                            {lead.total_linkedin > 0 ? (
                              <Badge variant="secondary" className="gap-1">
                                <Linkedin className="h-3 w-3" />
                                {lead.total_linkedin}
                              </Badge>
                            ) : null}
                            {lead.total_emails === 0 && lead.total_phones === 0 && lead.total_linkedin === 0 && (
                              <span className="text-xs text-muted-foreground">None</span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          {lead.last_emailed_at ? (
                            <div className="text-sm">
                              <Badge variant="default" className="bg-green-600 mb-1">
                                Emailed
                              </Badge>
                              <div className="text-xs text-muted-foreground">
                                {new Date(lead.last_emailed_at).toLocaleDateString()}
                              </div>
                              {lead.email_count && lead.email_count > 1 && (
                                <div className="text-xs text-muted-foreground">
                                  {lead.email_count} times
                                </div>
                              )}
                            </div>
                          ) : (
                            <Badge variant="outline">Not Emailed</Badge>
                          )}
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
