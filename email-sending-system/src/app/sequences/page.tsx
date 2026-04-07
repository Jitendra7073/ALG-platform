"use client"

import * as React from "react"
import {
  Plus,
  Search,
  Mail,
  Clock,
  MoreVertical,
  Edit,
  Trash2,
  Power,
  PowerOff,
  ChevronDown,
  ChevronUp,
  GripVertical,
  X,
  Save,
  Calendar,
  FolderOpen,
  Link2,
  Eye,
  EyeOff
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

interface Template {
  id: string
  template_name: string
  template_subject: string
  position: number
  delay_days: number
  delay_hours: number
}

interface Sequence {
  id: string
  name: string
  description: string
  is_active: boolean
  created_at: string
  items?: Template[]
}

export default function SequencesPage() {
  const [sequences, setSequences] = React.useState<Sequence[]>([])
  const [templates, setTemplates] = React.useState<any[]>([])
  const [loading, setLoading] = React.useState(true)
  const [searchQuery, setSearchQuery] = React.useState("")
  const [showInactive, setShowInactive] = React.useState(false)
  const [expandedSequences, setExpandedSequences] = React.useState<Set<string>>(new Set())
  const [editingSequence, setEditingSequence] = React.useState<Sequence | null>(null)
  const [showAddModal, setShowAddModal] = React.useState(false)
  const [showEditModal, setShowEditModal] = React.useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState<Sequence | null>(null)
  const [showAddItemModal, setShowAddItemModal] = React.useState(false)
  const [selectedSequenceForItem, setSelectedSequenceForItem] = React.useState<Sequence | null>(null)
  const [draggedItem, setDraggedItem] = React.useState<{ sequenceId: string; itemId: string; index: number } | null>(null)
  const [previewItem, setPreviewItem] = React.useState<any | null>(null)
  const [editItem, setEditItem] = React.useState<any | null>(null)
  const [fullTemplateData, setFullTemplateData] = React.useState<any | null>(null)

  // Form states
  const [formData, setFormData] = React.useState({
    name: "",
    description: "",
    is_active: true
  })

  const [itemFormData, setItemFormData] = React.useState({
    template_id: "",
    delay_days: 0,
    delay_hours: 0
  })

  React.useEffect(() => {
    async function fetchData() {
      try {
        const [seqRes, tempRes] = await Promise.all([
          fetch(`/api/sequences?include_inactive=${showInactive}`),
          fetch("/api/templates")
        ])

        const seqJson = await seqRes.json()
        const tempJson = await tempRes.json()

        if (seqJson.success) setSequences((seqJson.data || []).map((seq: any) => ({
          ...seq,
          items: seq.items || []
        })))
        if (tempJson.success) setTemplates(tempJson.data)
      } catch (err) {
        console.error("Error fetching data:", err)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [showInactive])

  const filteredSequences = sequences.filter(seq => {
    const matchesSearch = seq.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         (seq.description && seq.description.toLowerCase().includes(searchQuery.toLowerCase()))
    return matchesSearch
  })

  async function handleCreateSequence() {
    try {
      const res = await fetch("/api/sequences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData)
      })

      const json = await res.json()
      if (json.success) {
        setSequences([json.data, ...sequences])
        setShowAddModal(false)
        setFormData({ name: "", description: "", is_active: true })
      }
    } catch (err) {
      console.error("Error creating sequence:", err)
    }
  }

  async function handleUpdateSequence() {
    if (!editingSequence) return

    try {
      const res = await fetch("/api/sequences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingSequence.id,
          ...formData
        })
      })

      const json = await res.json()
      if (json.success) {
        setSequences(sequences.map(seq =>
          seq.id === editingSequence.id ? {
            ...json.data,
            items: seq.items || []
          } : seq
        ))
        setShowEditModal(false)
        setEditingSequence(null)
        setFormData({ name: "", description: "", is_active: true })
      }
    } catch (err) {
      console.error("Error updating sequence:", err)
    }
  }

  async function handleToggleActive(sequence: Sequence) {
    try {
      const res = await fetch("/api/sequences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: sequence.id,
          name: sequence.name,
          description: sequence.description,
          is_active: !sequence.is_active
        })
      })

      const json = await res.json()
      if (json.success) {
        setSequences(sequences.map(seq =>
          seq.id === sequence.id ? {
            ...json.data,
            items: seq.items || []
          } : seq
        ))
      }
    } catch (err) {
      console.error("Error toggling sequence:", err)
    }
  }

  async function handleDeleteSequence() {
    if (!showDeleteConfirm) return

    try {
      const res = await fetch(`/api/sequences?id=${showDeleteConfirm.id}`, {
        method: "DELETE"
      })

      const json = await res.json()
      if (json.success) {
        setSequences(sequences.filter(seq => seq.id !== showDeleteConfirm.id))
        setShowDeleteConfirm(null)
      }
    } catch (err) {
      console.error("Error deleting sequence:", err)
    }
  }

  async function handleAddItem() {
    if (!selectedSequenceForItem) return

    try {
      const res = await fetch(`/api/sequences/${selectedSequenceForItem.id}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(itemFormData)
      })

      const json = await res.json()
      if (json.success) {
        // Refresh sequences
        const seqRes = await fetch("/api/sequences")
        const seqJson = await seqRes.json()
        if (seqJson.success) {
          setSequences(seqJson.data)
        }
        setShowAddItemModal(false)
        setItemFormData({ template_id: "", delay_days: 0, delay_hours: 0 })
        setSelectedSequenceForItem(null)
      }
    } catch (err) {
      console.error("Error adding item:", err)
    }
  }

  async function handleRemoveItem(sequenceId: string, itemId: string) {
    try {
      const res = await fetch(`/api/sequences/${sequenceId}/items?item_id=${itemId}`, {
        method: "DELETE"
      })

      const json = await res.json()
      if (json.success) {
        setSequences(sequences.map(seq => {
          if (seq.id === sequenceId) {
            return {
              ...seq,
              items: seq.items.filter(item => item.id !== itemId)
            }
          }
          return seq
        }))
      }
    } catch (err) {
      console.error("Error removing item:", err)
    }
  }

  async function handleUpdateTemplate() {
    if (!fullTemplateData) return

    try {
      const res = await fetch(`/api/templates/${fullTemplateData.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: fullTemplateData.name,
          subject: fullTemplateData.subject,
          html_content: fullTemplateData.html_content,
          category: fullTemplateData.category
        })
      })

      const json = await res.json()
      if (json.success) {
        // Refetch templates and sequences
        const [tempRes, seqRes] = await Promise.all([
          fetch("/api/templates"),
          fetch(`/api/sequences?include_inactive=${showInactive}`)
        ])
        const [tempJson, seqJson] = await Promise.all([
          tempRes.json(),
          seqRes.json()
        ])

        if (tempJson.success) setTemplates(tempJson.data)
        if (seqJson.success) setSequences((seqJson.data || []).map((seq: any) => ({
          ...seq,
          items: seq.items || []
        })))

        setEditItem(null)
        setFullTemplateData(null)
      }
    } catch (err) {
      console.error("Error updating template:", err)
    }
  }

  async function handlePreviewItem(item: any) {
    try {
      // Fetch full template data
      const res = await fetch(`/api/templates/${item.template_id}`)
      const json = await res.json()
      if (json.success) {
        setPreviewItem(item)
        setFullTemplateData(json.data)
      }
    } catch (err) {
      console.error("Error fetching template:", err)
    }
  }

  async function handleEditItem(sequenceId: string, item: any) {
    try {
      // Fetch full template data
      const res = await fetch(`/api/templates/${item.template_id}`)
      const json = await res.json()
      if (json.success) {
        setEditItem({ ...item, sequenceId })
        setFullTemplateData(json.data)
      }
    } catch (err) {
      console.error("Error fetching template:", err)
    }
  }

  async function handleDropItem(sequenceId: string, draggedItemId: string, targetIndex: number) {
    const sequence = sequences.find(s => s.id === sequenceId)
    if (!sequence) return

    const items = [...sequence.items]
    const currentIndex = items.findIndex(i => i.id === draggedItemId)
    if (currentIndex === -1 || currentIndex === targetIndex) return

    // Get the target item's position
    const targetItem = items[targetIndex]
    const newPosition = targetItem.position

    try {
      const res = await fetch(`/api/sequences/${sequenceId}/items`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          item_id: draggedItemId,
          position: newPosition
        })
      })

      const json = await res.json()
      if (json.success) {
        // Refetch only this sequence's items to get the correct order
        const itemsRes = await fetch(`/api/sequences/${sequenceId}/items`)
        const itemsJson = await itemsRes.json()

        if (itemsJson.success) {
          setSequences(prevSequences =>
            prevSequences.map(seq => {
              if (seq.id === sequenceId) {
                return {
                  ...seq,
                  items: itemsJson.data
                }
              }
              return seq
            })
          )
        }
      }
    } catch (err) {
      console.error("Error moving item:", err)
    }
  }

  function handleDragStart(sequenceId: string, itemId: string, index: number) {
    setDraggedItem({ sequenceId, itemId, index })
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
  }

  function handleDrop(e: React.DragEvent, sequenceId: string, targetIndex: number) {
    e.preventDefault()
    if (!draggedItem || draggedItem.sequenceId !== sequenceId) {
      setDraggedItem(null)
      return
    }

    handleDropItem(sequenceId, draggedItem.itemId, targetIndex)
  }

  function handleDragEnd() {
    // Reset dragged item state when drag ends (whether dropped successfully or not)
    setDraggedItem(null)
  }

  function toggleExpanded(sequenceId: string) {
    const newExpanded = new Set(expandedSequences)
    if (newExpanded.has(sequenceId)) {
      newExpanded.delete(sequenceId)
    } else {
      newExpanded.add(sequenceId)
    }
    setExpandedSequences(newExpanded)
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h2 className="text-3xl font-bold tracking-tight">Email Sequences</h2>
          <p className="text-muted-foreground">
            Create ordered email campaigns with automated delays
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            onClick={() => setShowInactive(!showInactive)}
            className={cn(showInactive && "bg-accent")}
          >
            {showInactive ? <PowerOff className="h-4 w-4 mr-2" /> : <Power className="h-4 w-4 mr-2" />}
            Show Inactive
          </Button>
          <Button className="gap-2" onClick={() => setShowAddModal(true)}>
            <Plus className="h-4 w-4" />
            New Sequence
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            className="w-full h-10 pl-10 pr-4 bg-card border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
            placeholder="Search sequences..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Sequences Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-48 bg-card rounded-xl border animate-pulse" />
          ))}
        </div>
      ) : filteredSequences.length === 0 ? (
        <div className="h-80 flex flex-col items-center justify-center border-2 border-dashed rounded-xl bg-muted/10">
          <Mail className="h-12 w-12 mb-4 text-muted-foreground" />
          <p className="text-xl font-medium">No sequences found</p>
          <p className="text-sm text-muted-foreground mt-2">
            {searchQuery ? "Try a different search term" : "Create your first email sequence"}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredSequences.map((sequence) => (
            <SequenceCard
              key={sequence.id}
              sequence={sequence}
              isExpanded={expandedSequences.has(sequence.id)}
              onToggle={() => toggleExpanded(sequence.id)}
              onEdit={() => {
                setEditingSequence(sequence)
                setFormData({
                  name: sequence.name,
                  description: sequence.description,
                  is_active: sequence.is_active
                })
                setShowEditModal(true)
              }}
              onDelete={() => setShowDeleteConfirm(sequence)}
              onToggleActive={() => handleToggleActive(sequence)}
              onAddItem={() => {
                setSelectedSequenceForItem(sequence)
                setShowAddItemModal(true)
              }}
              onRemoveItem={(itemId) => handleRemoveItem(sequence.id, itemId)}
              onDragStart={(itemId, index) => handleDragStart(sequence.id, itemId, index)}
              onDragOver={handleDragOver}
              onDrop={(e, index) => handleDrop(e, sequence.id, index)}
              onDragEnd={handleDragEnd}
              onPreviewItem={handlePreviewItem}
              onEditItem={handleEditItem}
              draggedItem={draggedItem}
            />
          ))}
        </div>
      )}

      {/* Add Sequence Modal */}
      {showAddModal && (
        <Modal
          title="Create New Sequence"
          onClose={() => setShowAddModal(false)}
          onSave={handleCreateSequence}
        >
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Sequence Name</label>
              <input
                className="w-full mt-1 h-10 px-3 bg-card border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
                placeholder="e.g., Welcome Series"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Description</label>
              <textarea
                className="w-full mt-1 h-24 px-3 bg-card border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
                placeholder="What is this sequence for?"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </div>
          </div>
        </Modal>
      )}

      {/* Edit Sequence Modal */}
      {showEditModal && editingSequence && (
        <Modal
          title="Edit Sequence"
          onClose={() => {
            setShowEditModal(false)
            setEditingSequence(null)
            setFormData({ name: "", description: "", is_active: true })
          }}
          onSave={handleUpdateSequence}
        >
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Sequence Name</label>
              <input
                className="w-full mt-1 h-10 px-3 bg-card border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
                placeholder="e.g., Welcome Series"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Description</label>
              <textarea
                className="w-full mt-1 h-24 px-3 bg-card border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
                placeholder="What is this sequence for?"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </div>
          </div>
        </Modal>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <Modal
          title="Delete Sequence"
          onClose={() => setShowDeleteConfirm(null)}
          onSave={handleDeleteSequence}
          saveText="Delete"
          saveClassName="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        >
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Are you sure you want to delete <strong>"{showDeleteConfirm.name}"</strong>?
            </p>
            <p className="text-sm text-destructive">
              This action cannot be undone. All templates in this sequence will be removed.
            </p>
          </div>
        </Modal>
      )}

      {/* Add Item Modal */}
      {showAddItemModal && selectedSequenceForItem && (
        <Modal
          title="Add Email to Sequence"
          onClose={() => {
            setShowAddItemModal(false)
            setSelectedSequenceForItem(null)
            setItemFormData({ template_id: "", delay_days: 0, delay_hours: 0 })
          }}
          onSave={handleAddItem}
        >
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Email Template</label>
              <select
                className="w-full mt-1 h-10 px-3 bg-card border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
                value={itemFormData.template_id}
                onChange={(e) => setItemFormData({ ...itemFormData, template_id: e.target.value })}
              >
                <option value="">Select a template...</option>
                {templates.map(template => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Delay Days</label>
                <input
                  type="number"
                  min="0"
                  className="w-full mt-1 h-10 px-3 bg-card border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder="0"
                  value={itemFormData.delay_days}
                  onChange={(e) => setItemFormData({ ...itemFormData, delay_days: parseInt(e.target.value) || 0 })}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Delay Hours</label>
                <input
                  type="number"
                  min="0"
                  max="23"
                  className="w-full mt-1 h-10 px-3 bg-card border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
                  placeholder="0"
                  value={itemFormData.delay_hours}
                  onChange={(e) => setItemFormData({ ...itemFormData, delay_hours: parseInt(e.target.value) || 0 })}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              This email will be sent after the specified delay from the previous email in the sequence.
            </p>
          </div>
        </Modal>
      )}

      {/* Preview Item Modal */}
      {previewItem && fullTemplateData && (
        <Modal
          title="Email Template Preview"
          onClose={() => {
            setPreviewItem(null)
            setFullTemplateData(null)
          }}
          onSave={() => {
            setPreviewItem(null)
            setFullTemplateData(null)
          }}
          saveText="Close"
          size="large"
        >
          <div className="space-y-4">
            {/* Email Header */}
            <div className="bg-gradient-to-r from-muted/50 to-muted/30 rounded-t-lg border-b">
              <div className="p-4 space-y-2">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                    <Mail className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-medium text-muted-foreground">From:</label>
                      <p className="text-sm">sender@example.com</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-xs font-medium text-muted-foreground">To:</label>
                      <p className="text-sm">recipient@example.com</p>
                    </div>
                  </div>
                </div>
                <div className="pl-11">
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-medium text-muted-foreground">Subject:</label>
                    <p className="text-sm font-semibold">{fullTemplateData.subject}</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Email Body */}
            <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
              <div className="p-8 max-w-2xl mx-auto">
                <div
                  className="email-content prose prose-base max-w-none"
                  dangerouslySetInnerHTML={{ __html: fullTemplateData.html_content }}
                  style={{
                    lineHeight: '1.6',
                    color: '#334155'
                  }}
                />
              </div>
            </div>

            {/* Email Footer Info */}
            <div className="bg-muted/30 rounded-lg p-4">
              <div className="grid grid-cols-3 gap-4 text-xs">
                <div>
                  <label className="font-medium text-muted-foreground">Delay</label>
                  <p className="mt-1 text-sm">
                    {previewItem.delay_days > 0 && `${previewItem.delay_days}d `}
                    {previewItem.delay_hours > 0 && `${previewItem.delay_hours}h`}
                    {previewItem.delay_days === 0 && previewItem.delay_hours === 0 && "Immediate"}
                  </p>
                </div>
                <div>
                  <label className="font-medium text-muted-foreground">Position</label>
                  <p className="mt-1 text-sm">{previewItem.position}</p>
                </div>
                <div>
                  <label className="font-medium text-muted-foreground">Category</label>
                  <p className="mt-1 text-sm">{fullTemplateData.category || 'General'}</p>
                </div>
              </div>
            </div>
          </div>

          <style jsx global>{`
            .email-content p {
              margin-bottom: 1em;
            }
            .email-content h1, .email-content h2, .email-content h3 {
              margin-top: 1.5em;
              margin-bottom: 0.75em;
              font-weight: 600;
            }
            .email-content ul, .email-content ol {
              margin-left: 1.5em;
              margin-bottom: 1em;
            }
            .email-content li {
              margin-bottom: 0.5em;
            }
            .email-content a {
              color: #3b82f6;
              text-decoration: underline;
            }
            .email-content strong, .email-content b {
              font-weight: 600;
            }
            .email-content em, .email-content i {
              font-style: italic;
            }
            .email-content blockquote {
              border-left: 4px solid #e2e8f0;
              padding-left: 1em;
              margin: 1em 0;
              color: #64748b;
            }
            .email-content code {
              background-color: #f1f5f9;
              padding: 0.2em 0.4em;
              border-radius: 4px;
              font-family: monospace;
              font-size: 0.9em;
            }
            .email-content pre {
              background-color: #f8fafc;
              border: 1px solid #e2e8f0;
              border-radius: 8px;
              padding: 1em;
              overflow-x: auto;
              margin: 1em 0;
            }
            .email-content img {
              max-width: 100%;
              height: auto;
              border-radius: 8px;
              margin: 1em 0;
            }
            .email-content table {
              width: 100%;
              border-collapse: collapse;
              margin: 1em 0;
            }
            .email-content th, .email-content td {
              border: 1px solid #e2e8f0;
              padding: 0.75em;
              text-align: left;
            }
            .email-content th {
              background-color: #f8fafc;
              font-weight: 600;
            }
            .email-content hr {
              border: none;
              border-top: 2px solid #e2e8f0;
              margin: 2em 0;
            }
            .email-content button, .email-content .btn {
              display: inline-block;
              padding: 0.75em 1.5em;
              background-color: #3b82f6;
              color: white;
              border: none;
              border-radius: 8px;
              font-weight: 600;
              cursor: pointer;
              text-decoration: none;
              margin: 0.5em 0;
            }
            .email-content button:hover, .email-content .btn:hover {
              background-color: #2563eb;
            }
          `}</style>
        </Modal>
      )}

      {/* Edit Item Modal */}
      {editItem && fullTemplateData && (
        <Modal
          title="Edit Email Template"
          onClose={() => {
            setEditItem(null)
            setFullTemplateData(null)
          }}
          onSave={handleUpdateTemplate}
        >
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Template Name</label>
              <input
                type="text"
                className="w-full mt-1 h-10 px-3 bg-card border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
                value={fullTemplateData.name}
                onChange={(e) => setFullTemplateData({ ...fullTemplateData, name: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Subject</label>
              <input
                type="text"
                className="w-full mt-1 h-10 px-3 bg-card border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
                value={fullTemplateData.subject}
                onChange={(e) => setFullTemplateData({ ...fullTemplateData, subject: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm font-medium">Category</label>
              <input
                type="text"
                className="w-full mt-1 h-10 px-3 bg-card border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
                value={fullTemplateData.category || ''}
                onChange={(e) => setFullTemplateData({ ...fullTemplateData, category: e.target.value })}
                placeholder="e.g., Welcome, Promotion, Follow-up"
              />
            </div>
            <div>
              <label className="text-sm font-medium">Email Body (HTML)</label>
              <textarea
                className="w-full mt-1 h-64 px-3 py-2 bg-card border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20 font-mono text-xs"
                value={fullTemplateData.html_content}
                onChange={(e) => setFullTemplateData({ ...fullTemplateData, html_content: e.target.value })}
                placeholder="<p>Your email content here...</p>"
              />
            </div>
            <div className="p-3 bg-muted/50 rounded-lg">
              <p className="text-xs text-muted-foreground">
                <strong>Note:</strong> This will update the template for all sequences using it. The changes will apply immediately.
              </p>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function SequenceCard({
  sequence,
  isExpanded,
  onToggle,
  onEdit,
  onDelete,
  onToggleActive,
  onAddItem,
  onRemoveItem,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
  onPreviewItem,
  onEditItem,
  draggedItem
}: {
  sequence: Sequence
  isExpanded: boolean
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
  onToggleActive: () => void
  onAddItem: () => void
  onRemoveItem: (itemId: string) => void
  onDragStart: (itemId: string, index: number) => void
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent, index: number) => void
  onDragEnd: () => void
  onPreviewItem: (item: any) => void
  onEditItem: (itemId: string, item: any) => void
  draggedItem: { sequenceId: string; itemId: string; index: number } | null
}) {
  const totalDelay = (sequence.items || []).reduce((acc, item) => {
    return acc + (item.delay_days || 0) + ((item.delay_hours || 0) / 24)
  }, 0)

  return (
    <Card className={cn(
      "group hover:shadow-lg transition-all bg-card/50 overflow-hidden border-border/60",
      !sequence.is_active && "opacity-60"
    )}>
      <CardHeader className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <CardTitle className="text-base font-semibold">{sequence.name}</CardTitle>
              {!sequence.is_active && (
                <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-muted text-muted-foreground">
                  Inactive
                </span>
              )}
            </div>
            <CardDescription className="text-xs line-clamp-2">
              {sequence.description || "No description"}
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={onToggle}
          >
            {isExpanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </Button>
        </div>

        <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <Mail className="h-3.5 w-3.5" />
            <span>{sequence.items?.length || 0} emails</span>
          </div>
          {totalDelay > 0 && (
            <div className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              <span>{Math.round(totalDelay)} days total</span>
            </div>
          )}
        </div>
      </CardHeader>

      {isExpanded && (
        <CardContent className="p-4 pt-0 border-t border-border/60">
          <div className="space-y-2 mt-4">
            {!sequence.items || sequence.items.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                No emails in this sequence yet
              </div>
            ) : (
              (sequence.items || []).map((item, index) => (
                <div
                  key={item.id}
                  draggable
                  onDragStart={() => onDragStart(item.id, index)}
                  onDragOver={onDragOver}
                  onDrop={(e) => onDrop(e, index)}
                  onDragEnd={onDragEnd}
                  className={cn(
                    "p-3 bg-background rounded-lg border border-border/60 group/item hover:border-primary/30 transition-colors cursor-move",
                    draggedItem?.itemId === item.id && "opacity-50",
                    draggedItem?.sequenceId === sequence.id && draggedItem?.index !== index && "border-primary/50"
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex flex-col items-center gap-1">
                      <div className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center">
                        {index + 1}
                      </div>
                      {index < (sequence.items?.length || 0) - 1 && (
                        <div className="w-0.5 h-8 bg-border" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2 flex-1">
                          <GripVertical className="h-4 w-4 text-muted-foreground mt-0.5 cursor-grab active:cursor-grabbing" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{item.template_name}</p>
                            <p className="text-xs text-muted-foreground truncate">{item.template_subject}</p>
                            {(item.delay_days > 0 || item.delay_hours > 0) && (
                              <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
                                <Calendar className="h-3 w-3" />
                                <span>
                                  {item.delay_days > 0 && `${item.delay_days}d `}
                                  {item.delay_hours > 0 && `${item.delay_hours}h`}
                                  {item.delay_days === 0 && item.delay_hours === 0 && "Immediate"}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-1 opacity-0 group-hover/item:opacity-100 transition-opacity">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => onPreviewItem(item)}
                          >
                            <Eye className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7"
                            onClick={() => onEditItem(sequence.id, item)}
                          >
                            <Edit className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => onRemoveItem(item.id)}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          <Button
            variant="outline"
            size="sm"
            className="w-full mt-4 gap-2"
            onClick={onAddItem}
          >
            <Plus className="h-4 w-4" />
            Add Email
          </Button>
        </CardContent>
      )}

      <div className="p-4 pt-0 border-t border-border/60 mt-auto flex items-center justify-between gap-2">
        <div className="flex gap-2">
          <Button variant="outline" size="sm" className="h-8" onClick={onEdit}>
            <Edit className="h-3.5 w-3.5 mr-1" />
            Edit
          </Button>
          <Button
            variant="outline"
            size="sm"
            className={cn(
              "h-8",
              sequence.is_active
                ? "text-orange-500 hover:text-orange-600 hover:bg-orange-500/10"
                : "text-green-500 hover:text-green-600 hover:bg-green-500/10"
            )}
            onClick={onToggleActive}
          >
            {sequence.is_active ? (
              <>
                <PowerOff className="h-3.5 w-3.5 mr-1" />
                Deactivate
              </>
            ) : (
              <>
                <Power className="h-3.5 w-3.5 mr-1" />
                Activate
              </>
            )}
          </Button>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-destructive hover:text-destructive hover:bg-destructive/10"
          onClick={onDelete}
        >
          <Trash2 className="h-3.5 w-3.5 mr-1" />
          Delete
        </Button>
      </div>
    </Card>
  )
}

function Modal({
  title,
  onClose,
  onSave,
  saveText = "Save",
  saveClassName = "",
  children
}: {
  title: string
  onClose: () => void
  onSave: () => void
  saveText?: string
  saveClassName?: string
  children: React.ReactNode
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm">
      <div className="bg-card rounded-xl border shadow-lg w-full max-w-md animate-in fade-in duration-200">
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="text-lg font-semibold">{title}</h3>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="p-4">{children}</div>

        <div className="flex items-center justify-end gap-2 p-4 border-t">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button className={cn("gap-2", saveClassName)} onClick={onSave}>
            <Save className="h-4 w-4" />
            {saveText}
          </Button>
        </div>
      </div>
    </div>
  )
}
