import React, { useState, ComponentType } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Hash,
  Users,
  MapPin,
  Folder,
  FolderPlus,
  Pencil,
  Trash2,
  Check,
  X,
  Search,
  ChevronDown,
  ChevronRight,
  GripVertical,
  ArrowRightLeft,
} from "lucide-react";
import { useFilter } from "@/contexts/FilterContext";
import api, { formatApiError } from "@/lib/api";
import { toast } from "sonner";
import type { Tag, Person, LocationItem, Category, ItemGroup, GroupType } from "@/types";

type RowFilterType = "tag" | "person" | "location" | "category";
export type SidebarTab = "tags" | "people" | "locations";

interface EditableRowProps {
  icon: ComponentType<{ className?: string; strokeWidth?: number | string; style?: React.CSSProperties }>;
  label: string;
  to: string;
  filterType: RowFilterType;
  filterValue: string;
  itemId: string;
  groupId?: string | null;
  iconColor?: string;
  onRename: (newName: string) => Promise<void>;
  onDelete: () => Promise<void>;
  onDragStart?: (e: React.DragEvent) => void;
  onRemoveFromGroup?: () => void;
  testIdPrefix?: string;
}

function EditableRow({
  icon: Icon,
  label,
  to,
  filterType,
  filterValue,
  itemId,
  groupId,
  iconColor,
  onRename,
  onDelete,
  onDragStart,
  onRemoveFromGroup,
  testIdPrefix = "sidebar-item",
}: EditableRowProps) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(label);
  const [loading, setLoading] = useState(false);
  const location = useLocation();
  const { tryAddFilter } = useFilter();

  const isActive = location.pathname === to;

  const handleSave = async (e: React.MouseEvent | React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const trimmed = val.trim();
    if (!trimmed || trimmed === label) {
      setEditing(false);
      setVal(label);
      return;
    }
    setLoading(true);
    try {
      await onRename(trimmed);
      setEditing(false);
      toast.success("Güncellendi");
    } catch (err: any) {
      toast.error(formatApiError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm(`"${label}" silinsin mi?`)) return;
    setLoading(true);
    try {
      await onDelete();
      toast.success("Silindi");
    } catch (err: any) {
      toast.error(formatApiError(err));
    } finally {
      setLoading(false);
    }
  };

  if (editing) {
    return (
      <form
        onSubmit={handleSave}
        className="flex items-center gap-1.5 px-2 py-1 bg-muted/70 rounded text-xs"
        onClick={(e) => e.stopPropagation()}
      >
        <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" style={iconColor ? { color: iconColor } : undefined} />
        <input
          type="text"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          autoFocus
          disabled={loading}
          className="flex-1 bg-transparent text-foreground outline-none border-b border-primary text-xs px-0.5 py-0.5"
          data-testid={`${testIdPrefix}-input`}
        />
        <button
          type="submit"
          disabled={loading}
          className="text-emerald-600 hover:text-emerald-700 p-0.5 cursor-pointer"
          data-testid={`${testIdPrefix}-save`}
        >
          <Check className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          disabled={loading}
          onClick={() => {
            setEditing(false);
            setVal(label);
          }}
          className="text-muted-foreground hover:text-foreground p-0.5 cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </form>
    );
  }

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(
          "application/json",
          JSON.stringify({ itemId, filterType, sourceGroupId: groupId || null })
        );
        onDragStart?.(e);
      }}
      className={`group flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs transition-all cursor-grab active:cursor-grabbing ${
        isActive
          ? "bg-foreground/10 text-foreground font-semibold"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
      }`}
    >
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        <GripVertical className="w-3 h-3 text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 cursor-grab" />
        <Link
          to={to}
          onClick={(e) => {
            if (tryAddFilter(filterType, filterValue, e)) {
              e.preventDefault();
            }
          }}
          className="flex items-center gap-2 min-w-0 flex-1 truncate"
          data-testid={`${testIdPrefix}-link`}
        >
          <Icon className="w-3.5 h-3.5 shrink-0" style={iconColor ? { color: iconColor } : undefined} />
          <span className="truncate">{label}</span>
        </Link>
      </div>

      <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 shrink-0 ml-1 transition-opacity">
        {groupId && onRemoveFromGroup && (
          <button
            type="button"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onRemoveFromGroup();
            }}
            className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-background/80 transition-colors cursor-pointer"
            title="Gruptan Çıkar (Serbest Bırak)"
          >
            <ArrowRightLeft className="w-3 h-3" />
          </button>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setEditing(true);
          }}
          className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-background/80 transition-colors cursor-pointer"
          title="Yeniden adlandır"
          data-testid={`${testIdPrefix}-edit`}
        >
          <Pencil className="w-3 h-3" />
        </button>
        <button
          type="button"
          onClick={handleDelete}
          className="text-muted-foreground hover:text-destructive p-1 rounded hover:bg-background/80 transition-colors cursor-pointer"
          title="Sil"
          data-testid={`${testIdPrefix}-delete`}
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

interface SidebarProps {
  tags: Tag[];
  people: Person[];
  locations: LocationItem[];
  categories?: Category[];
  groups: ItemGroup[];
  onChange?: () => void;
  defaultTab?: SidebarTab;
  onNavigate?: () => void;
}

export default function Sidebar({
  tags,
  people,
  locations,
  categories = [],
  groups = [],
  onChange,
  defaultTab = "tags",
  onNavigate,
}: SidebarProps) {
  const [activeTab, setActiveTab] = useState<SidebarTab>(defaultTab);
  const [filterQuery, setFilterQuery] = useState("");

  // Group collapsed states
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editGroupName, setEditGroupName] = useState("");
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupColor, setNewGroupColor] = useState("#6366f1");

  // Drag-over styling state
  const [dragOverGroupId, setDragOverGroupId] = useState<string | "ungrouped" | null>(null);

  const toggleGroup = (groupId: string) => {
    setCollapsedGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  // Group actions
  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newGroupName.trim()) return;
    try {
      await api.post("/groups", {
        name: newGroupName.trim(),
        type: activeTab,
        color: newGroupColor,
      });
      setNewGroupName("");
      setIsCreatingGroup(false);
      toast.success("Grup oluşturuldu");
      onChange?.();
    } catch (err: any) {
      toast.error(formatApiError(err) || "Grup oluşturulamadı");
    }
  };

  const handleUpdateGroupName = async (groupId: string) => {
    if (!editGroupName.trim()) {
      setEditingGroupId(null);
      return;
    }
    try {
      await api.put(`/groups/${groupId}`, { name: editGroupName.trim() });
      setEditingGroupId(null);
      toast.success("Grup adı güncellendi");
      onChange?.();
    } catch (err: any) {
      toast.error(formatApiError(err) || "Grup güncellenemedi");
    }
  };

  const handleDeleteGroup = async (groupId: string, groupName: string) => {
    if (!window.confirm(`"${groupName}" grubu silinsin mi? (Gruptaki öğeler serbest kalacaktır)`)) return;
    try {
      await api.delete(`/groups/${groupId}`);
      toast.success("Grup silindi, öğeler serbest bırakıldı");
      onChange?.();
    } catch (err: any) {
      toast.error(formatApiError(err) || "Grup silinemedi");
    }
  };

  // Item move (Drag & Drop)
  const handleDropItem = async (e: React.DragEvent, targetGroupId: string | null) => {
    e.preventDefault();
    setDragOverGroupId(null);
    try {
      const rawData = e.dataTransfer.getData("application/json");
      if (!rawData) return;
      const data = JSON.parse(rawData);
      const { itemId, filterType } = data;

      if (!itemId) return;

      const typeMap: Record<string, string> = {
        tag: "tags",
        person: "people",
        location: "locations",
      };
      const apiType = typeMap[filterType] || activeTab;

      await api.patch("/groups/assign", {
        type: apiType,
        item_id: itemId,
        group_id: targetGroupId,
      });

      toast.success(targetGroupId ? "Öğe gruba taşındı" : "Öğe serbest bırakıldı");
      onChange?.();
    } catch (err: any) {
      toast.error(formatApiError(err) || "Taşıma başarısız oldu");
    }
  };

  // Tags actions
  const handleRenameTag = async (tagId: string, newName: string) => {
    await api.put(`/tags/${tagId}`, { name: newName });
    onChange?.();
  };

  const handleDeleteTag = async (tagId: string) => {
    await api.delete(`/tags/${tagId}`);
    onChange?.();
  };

  // People actions
  const handleRenamePerson = async (personId: string, newName: string) => {
    await api.put(`/people/${personId}`, { name: newName });
    onChange?.();
  };

  const handleDeletePerson = async (personId: string) => {
    await api.delete(`/people/${personId}`);
    onChange?.();
  };

  // Locations actions
  const handleRenameLocation = async (locId: string, newName: string) => {
    await api.put(`/locations/${locId}`, { name: newName });
    onChange?.();
  };

  const handleDeleteLocation = async (locId: string) => {
    await api.delete(`/locations/${locId}`);
    onChange?.();
  };

  const q = filterQuery.toLowerCase().trim();
  const filteredTags = tags.filter((t) => !q || t.name.toLowerCase().includes(q));
  const filteredPeople = people.filter((p) => !q || p.name.toLowerCase().includes(q));
  const filteredLocations = locations.filter((l) => !q || l.name.toLowerCase().includes(q));

  // Current tab's groups
  const currentGroups = groups.filter((g) => g.type === activeTab);

  return (
    <aside className="w-full h-full flex flex-col p-4 select-none overflow-hidden" data-testid="sidebar-component">
      {/* 3-Tab Header Switcher: Etiketler, Kişiler, Konumlar */}
      <div className="grid grid-cols-3 p-1 bg-muted/60 rounded-md border border-border/60 mb-3 shrink-0 gap-0.5">
        <button
          type="button"
          onClick={() => {
            setActiveTab("tags");
            setFilterQuery("");
            setIsCreatingGroup(false);
          }}
          data-testid="sidebar-tab-tags"
          className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded text-xs font-medium transition-all cursor-pointer ${
            activeTab === "tags"
              ? "bg-card text-foreground shadow-2xs font-semibold"
              : "text-muted-foreground hover:text-foreground"
          }`}
          title="Etiketler"
        >
          <Hash className="w-3.5 h-3.5 text-sky-500 shrink-0" />
          <span className="truncate">Etiket</span>
          <span className="text-[10px] font-mono opacity-70">({tags.length})</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveTab("people");
            setFilterQuery("");
            setIsCreatingGroup(false);
          }}
          data-testid="sidebar-tab-people"
          className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded text-xs font-medium transition-all cursor-pointer ${
            activeTab === "people"
              ? "bg-card text-foreground shadow-2xs font-semibold"
              : "text-muted-foreground hover:text-foreground"
          }`}
          title="Kişiler"
        >
          <Users className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
          <span className="truncate">Kişi</span>
          <span className="text-[10px] font-mono opacity-70">({people.length})</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveTab("locations");
            setFilterQuery("");
            setIsCreatingGroup(false);
          }}
          data-testid="sidebar-tab-locations"
          className={`flex items-center justify-center gap-1.5 py-1.5 px-2 rounded text-xs font-medium transition-all cursor-pointer ${
            activeTab === "locations"
              ? "bg-card text-foreground shadow-2xs font-semibold"
              : "text-muted-foreground hover:text-foreground"
          }`}
          title="Konumlar"
        >
          <MapPin className="w-3.5 h-3.5 text-rose-500 shrink-0" />
          <span className="truncate">Konum</span>
          <span className="text-[10px] font-mono opacity-70">({locations.length})</span>
        </button>
      </div>

      {/* In-tab Quick Search Filter & Add Group Button */}
      <div className="flex items-center gap-1.5 mb-2.5 shrink-0">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder={
              activeTab === "tags"
                ? "Etiketlerde ara…"
                : activeTab === "people"
                ? "Kişilerde ara…"
                : "Konumlarda ara…"
            }
            className="w-full bg-muted/40 hover:bg-muted/60 focus:bg-background border border-border/70 rounded-md pl-8 pr-7 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/70 outline-none focus:ring-1 focus:ring-primary transition-all"
          />
          {filterQuery && (
            <button
              type="button"
              onClick={() => setFilterQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5 cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Add Group Button */}
        <button
          type="button"
          onClick={() => {
            setIsCreatingGroup(!isCreatingGroup);
          }}
          className={`p-1.5 rounded-md border text-xs flex items-center gap-1 cursor-pointer transition-colors ${
            isCreatingGroup
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-muted/50 border-border/70 text-muted-foreground hover:text-foreground hover:bg-muted"
          }`}
          title="Yeni Grup Ekle"
        >
          <FolderPlus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* New Group Inline Form */}
      {isCreatingGroup && (
        <form
          onSubmit={handleCreateGroup}
          className="mb-2.5 p-2 bg-muted/70 rounded-md border border-border/80 text-xs space-y-2 shrink-0 animate-in fade-in duration-150"
        >
          <div className="flex items-center justify-between text-[11px] font-medium text-foreground">
            <span className="flex items-center gap-1">
              <Folder className="w-3 h-3 text-primary" /> Yeni Grup ({activeTab === "tags" ? "Etiketler" : activeTab === "people" ? "Kişiler" : "Konumlar"})
            </span>
            <button
              type="button"
              onClick={() => setIsCreatingGroup(false)}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="Grup adı (örn. İş, Projeler, Seyahat)..."
              autoFocus
              className="flex-1 bg-background border border-border/80 rounded px-2 py-1 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary"
            />
            <input
              type="color"
              value={newGroupColor}
              onChange={(e) => setNewGroupColor(e.target.value)}
              title="Grup Rengi"
              className="w-6 h-6 rounded border border-border cursor-pointer bg-transparent p-0"
            />
            <button
              type="submit"
              className="bg-primary text-primary-foreground px-2 py-1 rounded font-medium text-xs hover:opacity-90 cursor-pointer"
            >
              Ekle
            </button>
          </div>
        </form>
      )}

      {/* Tab Content Panel with Groups and Drag-and-Drop */}
      <div className="flex-1 overflow-y-auto min-h-0 space-y-2 pr-1">
        {/* Render Groups for current tab */}
        {currentGroups.map((group) => {
          const isCollapsed = collapsedGroups[group.group_id] ?? false;
          const isEditing = editingGroupId === group.group_id;
          const isDragOver = dragOverGroupId === group.group_id;

          // Filter items belonging to this group
          let groupItems: React.ReactNode = null;
          let count = 0;

          if (activeTab === "tags") {
            const items = filteredTags.filter((t) => t.group_id === group.group_id);
            count = items.length;
            groupItems = items.map((tag) => (
              <EditableRow
                key={tag.tag_id}
                icon={Hash}
                label={tag.name}
                to={`/tag/${encodeURIComponent(tag.name)}`}
                filterType="tag"
                filterValue={tag.name}
                itemId={tag.tag_id}
                groupId={group.group_id}
                onRename={(newName) => handleRenameTag(tag.tag_id, newName)}
                onDelete={() => handleDeleteTag(tag.tag_id)}
                onRemoveFromGroup={() => handleDropItem({ dataTransfer: { getData: () => JSON.stringify({ itemId: tag.tag_id, filterType: "tag" }) }, preventDefault: () => {} } as any, null)}
                testIdPrefix={`tag-${tag.name}`}
              />
            ));
          } else if (activeTab === "people") {
            const items = filteredPeople.filter((p) => p.group_id === group.group_id);
            count = items.length;
            groupItems = items.map((p) => (
              <EditableRow
                key={p.person_id}
                icon={Users}
                label={p.name}
                to={`/person/${encodeURIComponent(p.name)}`}
                filterType="person"
                filterValue={p.name}
                itemId={p.person_id}
                groupId={group.group_id}
                onRename={(newName) => handleRenamePerson(p.person_id, newName)}
                onDelete={() => handleDeletePerson(p.person_id)}
                onRemoveFromGroup={() => handleDropItem({ dataTransfer: { getData: () => JSON.stringify({ itemId: p.person_id, filterType: "person" }) }, preventDefault: () => {} } as any, null)}
                testIdPrefix={`person-${p.name}`}
              />
            ));
          } else if (activeTab === "locations") {
            const items = filteredLocations.filter((l) => l.group_id === group.group_id);
            count = items.length;
            groupItems = items.map((loc) => (
              <EditableRow
                key={loc.location_id}
                icon={MapPin}
                label={loc.name}
                to={`/location/${loc.location_id}`}
                filterType="location"
                filterValue={loc.location_id}
                itemId={loc.location_id}
                groupId={group.group_id}
                onRename={(newName) => handleRenameLocation(loc.location_id, newName)}
                onDelete={() => handleDeleteLocation(loc.location_id)}
                onRemoveFromGroup={() => handleDropItem({ dataTransfer: { getData: () => JSON.stringify({ itemId: loc.location_id, filterType: "location" }) }, preventDefault: () => {} } as any, null)}
                testIdPrefix={`location-${loc.location_id}`}
              />
            ));
          }

          return (
            <div
              key={group.group_id}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverGroupId(group.group_id);
              }}
              onDragLeave={() => setDragOverGroupId(null)}
              onDrop={(e) => handleDropItem(e, group.group_id)}
              className={`rounded-lg border transition-all duration-150 overflow-hidden ${
                isDragOver
                  ? "border-primary bg-primary/10 ring-2 ring-primary/30"
                  : "border-border/60 bg-card/50 hover:border-border"
              }`}
            >
              {/* Group Header */}
              <div className="group/header flex items-center justify-between px-2.5 py-1.5 bg-muted/40 hover:bg-muted/70 cursor-pointer text-xs font-medium">
                {isEditing ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleUpdateGroupName(group.group_id);
                    }}
                    className="flex items-center gap-1 flex-1 mr-1"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="text"
                      value={editGroupName}
                      onChange={(e) => setEditGroupName(e.target.value)}
                      autoFocus
                      className="flex-1 bg-background border border-primary rounded px-1.5 py-0.5 text-xs text-foreground outline-none"
                    />
                    <button type="submit" className="text-emerald-600 hover:text-emerald-700 p-0.5 cursor-pointer">
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingGroupId(null)}
                      className="text-muted-foreground hover:text-foreground p-0.5 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </form>
                ) : (
                  <div
                    onClick={() => toggleGroup(group.group_id)}
                    className="flex items-center gap-1.5 min-w-0 flex-1 truncate"
                  >
                    {isCollapsed ? (
                      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    )}
                    <Folder
                      className="w-3.5 h-3.5 shrink-0"
                      style={group.color ? { color: group.color } : { color: "hsl(var(--primary))" }}
                    />
                    <span className="truncate text-foreground font-semibold">{group.name}</span>
                    <span className="text-[10px] font-mono text-muted-foreground">({count})</span>
                  </div>
                )}

                {!isEditing && (
                  <div className="opacity-0 group-hover/header:opacity-100 flex items-center gap-1 shrink-0 transition-opacity">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingGroupId(group.group_id);
                        setEditGroupName(group.name);
                      }}
                      className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-background/80 cursor-pointer"
                      title="Grup Adını Güncelle"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteGroup(group.group_id, group.name);
                      }}
                      className="text-muted-foreground hover:text-destructive p-1 rounded hover:bg-background/80 cursor-pointer"
                      title="Grup Sil (Öğeleri serbest bırak)"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>

              {/* Group Body */}
              {!isCollapsed && (
                <div className="p-1 pl-2 space-y-0.5 min-h-[28px]">
                  {count === 0 ? (
                    <div className="py-2 text-center text-[11px] text-muted-foreground/60 italic border border-dashed border-border/40 rounded">
                      Öğeleri buraya sürükleyin
                    </div>
                  ) : (
                    groupItems
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Ungrouped (Serbest) items container */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOverGroupId("ungrouped");
          }}
          onDragLeave={() => setDragOverGroupId(null)}
          onDrop={(e) => handleDropItem(e, null)}
          className={`rounded-lg border transition-all duration-150 p-1 ${
            dragOverGroupId === "ungrouped"
              ? "border-primary/80 bg-primary/5 ring-1 ring-primary/20"
              : "border-transparent"
          }`}
        >
          {currentGroups.length > 0 && (
            <div className="px-2 py-1 text-[11px] font-semibold text-muted-foreground/80 flex items-center justify-between">
              <span>Grupsuz Öğeler</span>
              <span className="text-[10px] text-muted-foreground/60 italic">Sürükle bırak yapılabilir</span>
            </div>
          )}

          {/* Tags Tab Ungrouped */}
          {activeTab === "tags" && (
            <div>
              {filteredTags.filter((t) => !t.group_id).length === 0 && currentGroups.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground/70 italic">
                  {filterQuery ? "Eşleşen etiket bulunamadı." : "Henüz etiket eklenmemiş (#etiket)"}
                </div>
              ) : (
                filteredTags
                  .filter((t) => !t.group_id)
                  .map((tag) => (
                    <EditableRow
                      key={tag.tag_id}
                      icon={Hash}
                      label={tag.name}
                      to={`/tag/${encodeURIComponent(tag.name)}`}
                      filterType="tag"
                      filterValue={tag.name}
                      itemId={tag.tag_id}
                      onRename={(newName) => handleRenameTag(tag.tag_id, newName)}
                      onDelete={() => handleDeleteTag(tag.tag_id)}
                      testIdPrefix={`tag-${tag.name}`}
                    />
                  ))
              )}
            </div>
          )}

          {/* People Tab Ungrouped */}
          {activeTab === "people" && (
            <div>
              {filteredPeople.filter((p) => !p.group_id).length === 0 && currentGroups.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground/70 italic">
                  {filterQuery ? "Eşleşen kişi bulunamadı." : "Henüz kişi eklenmemiş (@kisi)"}
                </div>
              ) : (
                filteredPeople
                  .filter((p) => !p.group_id)
                  .map((p) => (
                    <EditableRow
                      key={p.person_id}
                      icon={Users}
                      label={p.name}
                      to={`/person/${encodeURIComponent(p.name)}`}
                      filterType="person"
                      filterValue={p.name}
                      itemId={p.person_id}
                      onRename={(newName) => handleRenamePerson(p.person_id, newName)}
                      onDelete={() => handleDeletePerson(p.person_id)}
                      testIdPrefix={`person-${p.name}`}
                    />
                  ))
              )}
            </div>
          )}

          {/* Locations Tab Ungrouped */}
          {activeTab === "locations" && (
            <div>
              {filteredLocations.filter((l) => !l.group_id).length === 0 && currentGroups.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground/70 italic">
                  {filterQuery ? "Eşleşen konum bulunamadı." : "Henüz kayıtlı konum yok"}
                </div>
              ) : (
                filteredLocations
                  .filter((l) => !l.group_id)
                  .map((loc) => (
                    <EditableRow
                      key={loc.location_id}
                      icon={MapPin}
                      label={loc.name}
                      to={`/location/${loc.location_id}`}
                      filterType="location"
                      filterValue={loc.location_id}
                      itemId={loc.location_id}
                      onRename={(newName) => handleRenameLocation(loc.location_id, newName)}
                      onDelete={() => handleDeleteLocation(loc.location_id)}
                      testIdPrefix={`location-${loc.location_id}`}
                    />
                  ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Tip footer */}
      <div className="pt-3 mt-2 border-t border-border/50 text-[10px] text-muted-foreground/80 flex items-center justify-between shrink-0">
        <span>İpucu: Öğeleri gruplara sürükleyip bırakabilirsiniz</span>
      </div>
    </aside>
  );
}
