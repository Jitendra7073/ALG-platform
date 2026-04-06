"use client";

import { useState, useEffect } from "react";
import { settingsApi, type SettingsResponse } from "@/lib/api/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Clock, Mail, RefreshCw, Settings2, Zap } from "lucide-react";

export default function SettingsPage() {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [localValues, setLocalValues] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    setIsLoading(true);
    try {
      const data = await settingsApi.get();
      setSettings(data);
      setLocalValues(data.values);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to load settings");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    if (!settings) return;

    setIsSaving(true);
    try {
      await settingsApi.update(localValues);
      toast.success("Settings saved successfully");
      // Reload to get updated values
      loadSettings();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to save settings");
    } finally {
      setIsSaving(false);
    }
  };

  const updateValue = (key: string, value: string) => {
    setLocalValues((prev) => ({ ...prev, [key]: value }));
  };

  const getNumberValue = (key: string, defaultValue: number = 0) => {
    return parseInt(localValues[key] || String(defaultValue)) || defaultValue;
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Settings</h2>
          <p className="text-muted-foreground">Configure system settings</p>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <Skeleton className="h-6 w-1/3" />
                <Skeleton className="h-4 w-2/3 mt-2" />
              </CardHeader>
              <CardContent>
                <Skeleton className="h-32 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (!settings) return null;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Settings</h2>
          <p className="text-muted-foreground">
            Configure system-wide email sending behavior
          </p>
        </div>
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? (
            <>
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            "Save Changes"
          )}
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Email Sending Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Email Sending
            </CardTitle>
            <CardDescription>
              Configure email sending delays and timing
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="per_email_delay">Delay Between Emails (ms)</Label>
              <Input
                id="per_email_delay"
                type="number"
                min="0"
                value={getNumberValue("per_email_delay", 1000)}
                onChange={(e) => updateValue("per_email_delay", e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Milliseconds to wait between sending individual emails
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cycle_cooldown_min">Cycle Cooldown - Min (minutes)</Label>
              <Input
                id="cycle_cooldown_min"
                type="number"
                min="0"
                value={getNumberValue("cycle_cooldown_min", 5)}
                onChange={(e) => updateValue("cycle_cooldown_min", e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Minimum cooldown between sending cycles
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="cycle_cooldown_max">Cycle Cooldown - Max (minutes)</Label>
              <Input
                id="cycle_cooldown_max"
                type="number"
                min="0"
                value={getNumberValue("cycle_cooldown_max", 15)}
                onChange={(e) => updateValue("cycle_cooldown_max", e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Maximum cooldown between sending cycles
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Follow-up Settings */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Follow-up Gaps
            </CardTitle>
            <CardDescription>
              Configure delays between follow-up emails
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="followup_gap_1">Follow-up 1 Gap (days)</Label>
              <Input
                id="followup_gap_1"
                type="number"
                min="0"
                value={getNumberValue("followup_gap_1", 2)}
                onChange={(e) => updateValue("followup_gap_1", e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Days before first follow-up email
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="followup_gap_2">Follow-up 2 Gap (days)</Label>
              <Input
                id="followup_gap_2"
                type="number"
                min="0"
                value={getNumberValue("followup_gap_2", 4)}
                onChange={(e) => updateValue("followup_gap_2", e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Days before second follow-up email
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="followup_gap_3">Follow-up 3 Gap (days)</Label>
              <Input
                id="followup_gap_3"
                type="number"
                min="0"
                value={getNumberValue("followup_gap_3", 7)}
                onChange={(e) => updateValue("followup_gap_3", e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Days before third follow-up email
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="followup_gap_4">Follow-up 4 Gap (days)</Label>
              <Input
                id="followup_gap_4"
                type="number"
                min="0"
                value={getNumberValue("followup_gap_4", 14)}
                onChange={(e) => updateValue("followup_gap_4", e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Days before fourth follow-up email
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* All Settings Table (for reference) */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings2 className="h-5 w-5" />
            All Settings
          </CardTitle>
          <CardDescription>
            Complete list of system settings
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {settings.settings.map((setting) => (
              <div key={setting.key} className="flex items-center justify-between p-2 rounded bg-muted/30">
                <div className="flex-1">
                  <div className="font-medium text-sm">{setting.label || setting.key}</div>
                  <div className="text-xs text-muted-foreground">{setting.description || setting.key}</div>
                </div>
                <div className="text-sm font-mono">{setting.value}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
