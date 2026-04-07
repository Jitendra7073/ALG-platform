"use client"

import * as React from "react"
import { 
  Plus, 
  Search, 
  FileText, 
  Copy, 
  MoreHorizontal,
  Layout,
  Code
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface Template {
  id: string
  name: string
  subject: string
  category: string
  created_at: string
  is_active: boolean
}

export default function TemplatesPage() {
  const [templates, setTemplates] = React.useState<Template[]>([])
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    async function fetchTemplates() {
      try {
        const res = await fetch("/api/templates")
        const json = await res.json()
        if (json.success) setTemplates(json.data)
      } catch (err) {
        console.error(err)
      } finally {
        setLoading(false)
      }
    }
    fetchTemplates()
  }, [])

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h2 className="text-3xl font-bold tracking-tight">Email Templates</h2>
          <p className="text-muted-foreground">Design and manage reusable content for your campaigns.</p>
        </div>
        <Button className="gap-2">
          <Plus className="h-4 w-4" />
          New Template
        </Button>
      </div>

      <div className="flex items-center gap-4">
         <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input className="w-full h-10 pl-10 pr-4 bg-card border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20" placeholder="Search templates..." />
         </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {loading ? (
          [...Array(4)].map((_, i) => (
            <div key={i} className="h-64 bg-card rounded-xl border animate-pulse" />
          ))
        ) : templates.length === 0 ? (
          <div className="col-span-full h-80 flex flex-col items-center justify-center border-2 border-dashed rounded-xl bg-muted/10 opacity-50">
             <FileText className="h-12 w-12 mb-4" />
             <p className="text-xl font-medium">No templates matching your research</p>
             <p className="text-sm text-muted-foreground mt-2">Start by creating a new email template from scratch.</p>
          </div>
        ) : (
          templates.map((template) => (
            <TemplateCard key={template.id} template={template} />
          ))
        )}
      </div>
    </div>
  )
}

function TemplateCard({ template }: { template: Template }) {
  return (
    <Card className="group hover:shadow-lg transition-all flex flex-col h-full bg-card/50 overflow-hidden border-border/60">
       <div className="h-40 w-full bg-muted/30 p-4 relative flex items-center justify-center group-hover:bg-muted/50 transition-colors">
          <div className="absolute top-2 right-2 flex gap-1 group-hover:opacity-100 transition-opacity opacity-0">
             <Button variant="secondary" size="icon" className="h-8 w-8"><Copy className="h-3.5 w-3.5" /></Button>
             <Button variant="secondary" size="icon" className="h-8 w-8"><MoreHorizontal className="h-3.5 w-3.5" /></Button>
          </div>
          <div className="p-4 bg-background shadow-sm rounded border max-w-[80%] max-h-[80%] overflow-hidden pointer-events-none opacity-40 group-hover:opacity-100 transition-opacity">
             <div className="h-2 w-20 bg-muted rounded mb-2" />
             <div className="h-1.5 w-full bg-muted rounded mb-1" />
             <div className="h-1.5 w-full bg-muted rounded mb-1" />
             <div className="h-1.5 w-32 bg-muted rounded mb-1" />
          </div>
          <div className="absolute inset-0 bg-gradient-to-t from-background to-transparent opacity-0 group-hover:opacity-20 pointer-events-none" />
       </div>

       <CardHeader className="p-4 pt-5">
          <div className="flex items-center gap-2 mb-2">
             <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-blue-500/10 text-blue-500 border border-blue-500/20">
                {template.category || 'General'}
             </span>
          </div>
          <CardTitle className="text-base font-semibold leading-tight">{template.name}</CardTitle>
          <CardDescription className="line-clamp-2 text-xs mt-1">{template.subject}</CardDescription>
       </CardHeader>
       
       <CardFooter className="p-4 pt-0 mt-auto flex items-center justify-between border-t border-muted/30 pt-4">
           <div className="flex items-center gap-2">
             <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
                <Code className="h-3.5 w-3.5" /> HTML
             </Button>
             <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5">
                <Layout className="h-3.5 w-3.5" /> Layout
             </Button>
           </div>
       </CardFooter>
    </Card>
  )
}
