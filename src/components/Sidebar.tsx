import React, { useState, useEffect, useCallback, ComponentType } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  Hash,
  Users,
  MapPin,
  Sparkles,
  MessageSquareQuote,
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
  Plus,
  Copy,
  Smile,
  Type,
  FileText,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useFilter } from "@/contexts/FilterContext";
import api, { formatApiError } from "@/lib/api";
import { toast } from "sonner";
import type { Tag, Person, LocationItem, ItemGroup, StickerItem, PhraseItem } from "@/types";
import LocationPicker from "@/components/LocationPicker";

export type RowFilterType = "tag" | "person" | "location" | "sticker" | "phrase";
export type SidebarTab = "tags" | "people" | "locations" | "stickers" | "phrases";

interface EditableRowProps {
  icon: ComponentType<{ className?: string; strokeWidth?: number | string; style?: React.CSSProperties }>;
  emojiContent?: string;
  label: string;
  subLabel?: string;
  to?: string;
  filterType: RowFilterType;
  filterValue: string;
  itemId: string;
  groupId?: string | null;
  groups: ItemGroup[];
  iconColor?: string;
  onRename: (newName: string, extra?: any) => Promise<void>;
  onDelete: () => Promise<void>;
  onMoveToGroup: (targetGroupId: string | null) => Promise<void>;
  onDragStart?: (e: React.DragEvent) => void;
  onClickCopy?: () => void;
  testIdPrefix?: string;
}

function EditableRow({
  icon: Icon,
  emojiContent,
  label,
  subLabel,
  to,
  filterType,
  filterValue,
  itemId,
  groupId,
  groups,
  iconColor,
  onRename,
  onDelete,
  onMoveToGroup,
  onDragStart,
  onClickCopy,
  testIdPrefix = "sidebar-item",
}: EditableRowProps) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(label);
  const [subVal, setSubVal] = useState(subLabel || "");
  const [loading, setLoading] = useState(false);
  const location = useLocation();
  const { tryAddFilter } = useFilter();

  const isActive = to ? location.pathname === to : false;

  const handleSave = async (e: React.MouseEvent | React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const trimmed = val.trim();
    if (!trimmed) {
      setEditing(false);
      setVal(label);
      return;
    }
    setLoading(true);
    try {
      await onRename(trimmed, subVal.trim());
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
        className="flex flex-col gap-1 px-2 py-1.5 bg-muted/80 rounded text-xs"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-1.5">
          {emojiContent ? (
            <span className="text-sm shrink-0 leading-none">{emojiContent}</span>
          ) : (
            <Icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" style={iconColor ? { color: iconColor } : undefined} />
          )}
          <input
            type="text"
            value={val}
            onChange={(e) => setVal(e.target.value)}
            autoFocus
            disabled={loading}
            placeholder={filterType === "phrase" ? "Anahtar Sözcük" : "İsim"}
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
              setSubVal(subLabel || "");
            }}
            className="text-muted-foreground hover:text-foreground p-0.5 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        {filterType === "phrase" && (
          <div className="space-y-0.5 pt-0.5">
            <textarea
              value={subVal}
              onChange={(e) => setSubVal(e.target.value)}
              maxLength={120}
              placeholder="Cümle metni (Maks 120 karakter)..."
              className="w-full bg-background/80 text-foreground border border-border rounded p-1 text-[11px] outline-none focus:border-primary resize-none h-12"
            />
            <div className="text-[10px] text-right text-muted-foreground font-mono">
              {subVal.length}/120
            </div>
          </div>
        )}
      </form>
    );
  }

  const handleCopyText = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const textToCopy = subLabel || emojiContent || label;
    navigator.clipboard.writeText(textToCopy);
    toast.success(`"${textToCopy}" kopyalandı`);
    onClickCopy?.();
  };

  return (
    <div
      draggable
      onDragStart={(e) => {
        let textPayload = "";
        if (filterType === "tag") textPayload = `#${label}`;
        else if (filterType === "person") textPayload = `@${label}`;
        else if (filterType === "location") textPayload = `📍 ${label}`;
        else if (filterType === "sticker") textPayload = emojiContent || label;
        else if (filterType === "phrase") textPayload = subLabel || label;

        const payload = {
          type: filterType,
          filterType,
          itemId,
          name: label,
          label,
          filterValue,
          content: emojiContent || subLabel || label,
          phrase: subLabel || undefined,
          sourceGroupId: groupId || null,
          location_id: filterType === "location" ? itemId : undefined,
          tag_id: filterType === "tag" ? itemId : undefined,
          person_id: filterType === "person" ? itemId : undefined,
          sticker_id: filterType === "sticker" ? itemId : undefined,
          phrase_id: filterType === "phrase" ? itemId : undefined,
          data: {
            id: itemId,
            name: label,
            content: emojiContent || subLabel || label,
          },
        };

        e.dataTransfer.setData("application/json", JSON.stringify(payload));
        e.dataTransfer.setData("text/plain", textPayload);
        e.dataTransfer.effectAllowed = "copyMove";
        onDragStart?.(e);
      }}
      className={`group flex items-center justify-between px-2 py-1.5 rounded-md text-xs transition-all cursor-grab active:cursor-grabbing select-none ${
        isActive
          ? "bg-foreground/10 text-foreground font-semibold"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
      }`}
    >
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        <GripVertical className="w-3 h-3 text-muted-foreground/30 group-hover:text-muted-foreground transition-colors shrink-0 cursor-grab" />
        {to ? (
          <Link
            to={to}
            onClick={(e) => {
              if (tryAddFilter(filterType as any, filterValue, e)) {
                e.preventDefault();
              }
            }}
            className="flex items-center gap-1.5 min-w-0 flex-1 truncate"
            data-testid={`${testIdPrefix}-link`}
          >
            {emojiContent ? (
              <span className="text-sm shrink-0 leading-none">{emojiContent}</span>
            ) : (
              <Icon className="w-3.5 h-3.5 shrink-0" style={iconColor ? { color: iconColor } : undefined} />
            )}
            <span className="truncate">{label}</span>
          </Link>
        ) : (
          <div
            onClick={handleCopyText}
            className="flex items-center gap-1.5 min-w-0 flex-1 truncate cursor-pointer"
            title={subLabel ? `${label}: "${subLabel}" (Kopyalamak için tıklayın)` : `${label} (Kopyalamak için tıklayın)`}
          >
            {emojiContent ? (
              <span className="text-sm shrink-0 leading-none">{emojiContent}</span>
            ) : (
              <Icon className="w-3.5 h-3.5 shrink-0" style={iconColor ? { color: iconColor } : undefined} />
            )}
            <div className="min-w-0 flex-1 truncate">
              <span className="font-medium text-foreground truncate block">{label}</span>
              {subLabel && (
                <span className="text-[10px] text-muted-foreground truncate block leading-tight opacity-80">
                  {subLabel}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 shrink-0 ml-1 transition-opacity">
        {/* Copy Quick Button */}
        {(filterType === "sticker" || filterType === "phrase") && (
          <button
            type="button"
            onClick={handleCopyText}
            className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-background/80 transition-colors cursor-pointer"
            title="Metni Kopyala"
          >
            <Copy className="w-3 h-3" />
          </button>
        )}

        {/* Move to Group Dropdown Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-background/80 transition-colors cursor-pointer"
              title="Gruba Taşı"
              onClick={(e) => e.stopPropagation()}
            >
              <Folder className="w-3 h-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48 text-xs">
            <DropdownMenuLabel className="text-[11px] font-semibold text-muted-foreground">
              Gruba Taşı
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            {groups.length === 0 ? (
              <div className="p-2 text-center text-muted-foreground text-[11px] italic">
                Henüz grup yok
              </div>
            ) : (
              groups.map((g) => (
                <DropdownMenuItem
                  key={g.group_id}
                  onClick={() => onMoveToGroup(g.group_id)}
                  className={`flex items-center gap-2 cursor-pointer ${
                    groupId === g.group_id ? "font-bold text-primary bg-primary/10" : ""
                  }`}
                >
                  <Folder
                    className="w-3.5 h-3.5 shrink-0"
                    style={g.color ? { color: g.color } : { color: "hsl(var(--primary))" }}
                  />
                  <span className="truncate">{g.name}</span>
                  {groupId === g.group_id && <Check className="w-3 h-3 ml-auto text-primary" />}
                </DropdownMenuItem>
              ))
            )}
            {groupId && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => onMoveToGroup(null)}
                  className="text-muted-foreground hover:text-foreground cursor-pointer flex items-center gap-1.5"
                >
                  <ArrowRightLeft className="w-3 h-3" /> Gruptan Çıkar (Serbest Bırak)
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setEditing(true);
          }}
          className="text-muted-foreground hover:text-foreground p-1 rounded hover:bg-background/80 transition-colors cursor-pointer"
          title="Düzenle"
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

// Popular Emojis quick palette
const QUICK_EMOJIS = [
  "⭐", "🔥", "🚀", "❤️", "🎉", "💡", "☕", "📌", "✅", "⚠️",
  "🎯", "📝", "🏆", "👍", "🧠", "⚡", "🔔", "💎", "📅", "🏷️",
  "🌟", "✨", "🎨", "💼", "📚", "🌍", "✈️", "🍕", "🎵", "💰"
];

interface SidebarProps {
  tags: Tag[];
  people: Person[];
  locations: LocationItem[];
  stickers?: StickerItem[];
  phrases?: PhraseItem[];
  groups: ItemGroup[];
  onChange?: () => void;
  defaultTab?: SidebarTab;
  onNavigate?: () => void;
  categories?: any[];
}

export default function Sidebar({
  tags = [],
  people = [],
  locations = [],
  stickers: initialStickers,
  phrases: initialPhrases,
  groups = [],
  onChange,
  defaultTab = "tags",
  onNavigate,
}: SidebarProps) {
  const [activeTab, setActiveTab] = useState<SidebarTab>(defaultTab);
  const [filterQuery, setFilterQuery] = useState("");

  // Internal state for stickers & phrases if not passed directly
  const [stickersList, setStickersList] = useState<StickerItem[]>(initialStickers || []);
  const [phrasesList, setPhrasesList] = useState<PhraseItem[]>(initialPhrases || []);

  // Group collapsed states
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editGroupName, setEditGroupName] = useState("");
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupColor, setNewGroupColor] = useState("#6366f1");

  // Drag-over styling state
  const [dragOverGroupId, setDragOverGroupId] = useState<string | "ungrouped" | null>(null);

  // New Sticker Modal State
  const [stickerModalOpen, setStickerModalOpen] = useState(false);
  const [newStickerName, setNewStickerName] = useState("");
  const [newStickerContent, setNewStickerContent] = useState("⭐");
  const [newStickerType, setNewStickerType] = useState<"emoji" | "icon" | "sticker">("emoji");
  const [newStickerGroupId, setNewStickerGroupId] = useState<string | null>(null);
  const [isSavingSticker, setIsSavingSticker] = useState(false);

  // New Phrase Modal State
  const [phraseModalOpen, setPhraseModalOpen] = useState(false);
  const [newPhraseName, setNewPhraseName] = useState("");
  const [newPhraseText, setNewPhraseText] = useState("");
  const [newPhraseGroupId, setNewPhraseGroupId] = useState<string | null>(null);
  const [isSavingPhrase, setIsSavingPhrase] = useState(false);

  // Location Picker Modal for adding location
  const [locPickerOpen, setLocPickerOpen] = useState(false);

  // Fetch stickers and phrases from backend
  const fetchStickersAndPhrases = useCallback(async () => {
    try {
      const [stkRes, phrRes] = await Promise.all([
        api.get<StickerItem[]>("/stickers"),
        api.get<PhraseItem[]>("/phrases"),
      ]);
      setStickersList(Array.isArray(stkRes.data) ? stkRes.data : []);
      setPhrasesList(Array.isArray(phrRes.data) ? phrRes.data : []);
    } catch (e) {
      console.warn("Could not load stickers/phrases:", e);
    }
  }, []);

  useEffect(() => {
    if (initialStickers) setStickersList(initialStickers);
    if (initialPhrases) setPhrasesList(initialPhrases);
    if (!initialStickers || !initialPhrases) {
      fetchStickersAndPhrases();
    }
  }, [initialStickers, initialPhrases, fetchStickersAndPhrases]);

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

  // Direct move handler
  const handleMoveItemToGroup = async (itemId: string, itemType: string, targetGroupId: string | null) => {
    try {
      const typeMap: Record<string, string> = {
        tag: "tags",
        person: "people",
        location: "locations",
        sticker: "stickers",
        phrase: "phrases",
      };
      const apiType = typeMap[itemType] || activeTab;

      await api.patch("/groups/assign", {
        type: apiType,
        item_id: itemId,
        group_id: targetGroupId,
      });

      toast.success(targetGroupId ? "Öğe gruba taşındı" : "Öğe serbest bırakıldı");
      onChange?.();
      fetchStickersAndPhrases();
    } catch (err: any) {
      toast.error(formatApiError(err) || "Taşıma başarısız oldu");
    }
  };

  // Drag and drop drop handler
  const handleDropItem = async (e: React.DragEvent, targetGroupId: string | null) => {
    e.preventDefault();
    setDragOverGroupId(null);
    try {
      const rawData = e.dataTransfer.getData("application/json");
      if (!rawData) return;
      const data = JSON.parse(rawData);
      const { itemId, filterType } = data;

      if (!itemId) return;
      await handleMoveItemToGroup(itemId, filterType, targetGroupId);
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

  // Stickers actions
  const handleCreateSticker = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStickerName.trim() || !newStickerContent.trim()) {
      toast.error("İsim ve emoji/sticker içeriği zorunludur");
      return;
    }
    setIsSavingSticker(true);
    try {
      await api.post("/stickers", {
        name: newStickerName.trim(),
        content: newStickerContent.trim(),
        type: newStickerType,
        group_id: newStickerGroupId,
      });
      setNewStickerName("");
      setNewStickerContent("⭐");
      setStickerModalOpen(false);
      toast.success("Sticker / Emoji eklendi");
      fetchStickersAndPhrases();
      onChange?.();
    } catch (err: any) {
      toast.error(formatApiError(err) || "Sticker eklenemedi");
    } finally {
      setIsSavingSticker(false);
    }
  };

  const handleUpdateSticker = async (stickerId: string, newName: string, newContent?: string) => {
    await api.put(`/stickers/${stickerId}`, {
      name: newName,
      ...(newContent ? { content: newContent } : {}),
    });
    fetchStickersAndPhrases();
    onChange?.();
  };

  const handleDeleteSticker = async (stickerId: string) => {
    await api.delete(`/stickers/${stickerId}`);
    fetchStickersAndPhrases();
    onChange?.();
  };

  // Phrases actions
  const handleCreatePhrase = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPhraseName.trim() || !newPhraseText.trim()) {
      toast.error("Anahtar sözcük ve cümle metni zorunludur");
      return;
    }
    if (newPhraseText.trim().length > 120) {
      toast.error("Cümle metni en fazla 120 karakter olabilir");
      return;
    }
    setIsSavingPhrase(true);
    try {
      await api.post("/phrases", {
        name: newPhraseName.trim(),
        phrase: newPhraseText.trim(),
        group_id: newPhraseGroupId,
      });
      setNewPhraseName("");
      setNewPhraseText("");
      setPhraseModalOpen(false);
      toast.success("Cümle / Şablon eklendi");
      fetchStickersAndPhrases();
      onChange?.();
    } catch (err: any) {
      toast.error(formatApiError(err) || "Cümle eklenemedi");
    } finally {
      setIsSavingPhrase(false);
    }
  };

  const handleUpdatePhrase = async (phraseId: string, newName: string, newPhraseText?: string) => {
    await api.put(`/phrases/${phraseId}`, {
      name: newName,
      ...(newPhraseText ? { phrase: newPhraseText } : {}),
    });
    fetchStickersAndPhrases();
    onChange?.();
  };

  const handleDeletePhrase = async (phraseId: string) => {
    await api.delete(`/phrases/${phraseId}`);
    fetchStickersAndPhrases();
    onChange?.();
  };

  // Filtering
  const q = filterQuery.toLowerCase().trim();
  const filteredTags = tags.filter((t) => !q || t.name.toLowerCase().includes(q));
  const filteredPeople = people.filter((p) => !q || p.name.toLowerCase().includes(q));
  const filteredLocations = locations.filter((l) => !q || l.name.toLowerCase().includes(q));
  const filteredStickers = stickersList.filter(
    (s) => !q || s.name.toLowerCase().includes(q) || s.content.toLowerCase().includes(q)
  );
  const filteredPhrases = phrasesList.filter(
    (p) => !q || p.name.toLowerCase().includes(q) || p.phrase.toLowerCase().includes(q)
  );

  // Current tab's groups
  const currentGroups = groups.filter((g) => g.type === activeTab);

  return (
    <aside className="w-full h-full flex flex-col p-3 select-none overflow-hidden" data-testid="sidebar-component">
      {/* 5-Tab Header Switcher: Etiketler, Kişiler, Konumlar, Sticker/Emoji, Cümleler */}
      <div className="grid grid-cols-5 p-1 bg-muted/60 rounded-md border border-border/60 mb-2 shrink-0 gap-0.5">
        {/* Tab 1: Tags */}
        <button
          type="button"
          onClick={() => {
            setActiveTab("tags");
            setFilterQuery("");
            setIsCreatingGroup(false);
          }}
          data-testid="sidebar-tab-tags"
          className={`flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1 py-1 px-1 rounded text-xs font-medium transition-all cursor-pointer ${
            activeTab === "tags"
              ? "bg-card text-foreground shadow-2xs font-semibold"
              : "text-muted-foreground hover:text-foreground"
          }`}
          title="Etiketler (#)"
        >
          <Hash className="w-3.5 h-3.5 text-sky-500 shrink-0" />
          <span className="truncate text-[11px]">Etiket</span>
        </button>

        {/* Tab 2: People */}
        <button
          type="button"
          onClick={() => {
            setActiveTab("people");
            setFilterQuery("");
            setIsCreatingGroup(false);
          }}
          data-testid="sidebar-tab-people"
          className={`flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1 py-1 px-1 rounded text-xs font-medium transition-all cursor-pointer ${
            activeTab === "people"
              ? "bg-card text-foreground shadow-2xs font-semibold"
              : "text-muted-foreground hover:text-foreground"
          }`}
          title="Kişiler (@)"
        >
          <Users className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
          <span className="truncate text-[11px]">Kişi</span>
        </button>

        {/* Tab 3: Locations */}
        <button
          type="button"
          onClick={() => {
            setActiveTab("locations");
            setFilterQuery("");
            setIsCreatingGroup(false);
          }}
          data-testid="sidebar-tab-locations"
          className={`flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1 py-1 px-1 rounded text-xs font-medium transition-all cursor-pointer ${
            activeTab === "locations"
              ? "bg-card text-foreground shadow-2xs font-semibold"
              : "text-muted-foreground hover:text-foreground"
          }`}
          title="Konumlar (📍)"
        >
          <MapPin className="w-3.5 h-3.5 text-rose-500 shrink-0" />
          <span className="truncate text-[11px]">Konum</span>
        </button>

        {/* Tab 4: Stickers & Emojis */}
        <button
          type="button"
          onClick={() => {
            setActiveTab("stickers");
            setFilterQuery("");
            setIsCreatingGroup(false);
          }}
          data-testid="sidebar-tab-stickers"
          className={`flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1 py-1 px-1 rounded text-xs font-medium transition-all cursor-pointer ${
            activeTab === "stickers"
              ? "bg-card text-foreground shadow-2xs font-semibold"
              : "text-muted-foreground hover:text-foreground"
          }`}
          title="Sticker, İkon ve Emojiler"
        >
          <Sparkles className="w-3.5 h-3.5 text-amber-500 shrink-0" />
          <span className="truncate text-[11px]">Emoji</span>
        </button>

        {/* Tab 5: Keywords & Phrases */}
        <button
          type="button"
          onClick={() => {
            setActiveTab("phrases");
            setFilterQuery("");
            setIsCreatingGroup(false);
          }}
          data-testid="sidebar-tab-phrases"
          className={`flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1 py-1 px-1 rounded text-xs font-medium transition-all cursor-pointer ${
            activeTab === "phrases"
              ? "bg-card text-foreground shadow-2xs font-semibold"
              : "text-muted-foreground hover:text-foreground"
          }`}
          title="Anahtar Sözcükler & Cümleler (Maks 120 Karakter)"
        >
          <MessageSquareQuote className="w-3.5 h-3.5 text-violet-500 shrink-0" />
          <span className="truncate text-[11px]">Cümle</span>
        </button>
      </div>

      {/* In-tab Quick Search Filter, Add Item & Add Group Buttons */}
      <div className="flex items-center gap-1 mb-2 shrink-0">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            value={filterQuery}
            onChange={(e) => setFilterQuery(e.target.value)}
            placeholder={
              activeTab === "tags"
                ? "Etiketlerde ara…"
                : activeTab === "people"
                ? "Kişilerde ara…"
                : activeTab === "locations"
                ? "Konumlarda ara…"
                : activeTab === "stickers"
                ? "Emoji / Sticker ara…"
                : "Cümle / Sözcük ara…"
            }
            className="w-full bg-muted/40 hover:bg-muted/60 focus:bg-background border border-border/70 rounded-md pl-7 pr-6 py-1 text-xs text-foreground placeholder:text-muted-foreground/70 outline-none focus:ring-1 focus:ring-primary transition-all"
          />
          {filterQuery && (
            <button
              type="button"
              onClick={() => setFilterQuery("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-0.5 cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Add Item Button (Stickers, Phrases, Locations) */}
        {activeTab === "stickers" && (
          <button
            type="button"
            onClick={() => setStickerModalOpen(true)}
            className="p-1 rounded-md border border-border/70 bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
            title="Yeni Sticker / Emoji Ekle"
          >
            <Plus className="w-3.5 h-3.5 text-amber-500" />
          </button>
        )}

        {activeTab === "phrases" && (
          <button
            type="button"
            onClick={() => setPhraseModalOpen(true)}
            className="p-1 rounded-md border border-border/70 bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
            title="Yeni Cümle / Şablon Ekle"
          >
            <Plus className="w-3.5 h-3.5 text-violet-500" />
          </button>
        )}

        {activeTab === "locations" && (
          <button
            type="button"
            onClick={() => setLocPickerOpen(true)}
            className="p-1 rounded-md border border-border/70 bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
            title="Yeni Konum Ekle"
          >
            <Plus className="w-3.5 h-3.5 text-rose-500" />
          </button>
        )}

        {/* Add Group Button */}
        <button
          type="button"
          onClick={() => {
            setIsCreatingGroup(!isCreatingGroup);
          }}
          className={`p-1 rounded-md border text-xs flex items-center gap-1 cursor-pointer transition-colors ${
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
          className="mb-2 p-2 bg-muted/70 rounded-md border border-border/80 text-xs space-y-1.5 shrink-0 animate-in fade-in duration-150"
        >
          <div className="flex items-center justify-between text-[11px] font-medium text-foreground">
            <span className="flex items-center gap-1 font-semibold">
              <Folder className="w-3.5 h-3.5 text-primary" /> Yeni Grup ({
                activeTab === "tags"
                  ? "Etiketler"
                  : activeTab === "people"
                  ? "Kişiler"
                  : activeTab === "locations"
                  ? "Konumlar"
                  : activeTab === "stickers"
                  ? "Sticker / Emoji"
                  : "Cümleler"
              })
            </span>
            <button
              type="button"
              onClick={() => setIsCreatingGroup(false)}
              className="text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="Grup adı (örn. Favoriler, İş)..."
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
      <div className="flex-1 overflow-y-auto min-h-0 space-y-1.5 pr-1">
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
                groups={currentGroups}
                onRename={(newName) => handleRenameTag(tag.tag_id, newName)}
                onDelete={() => handleDeleteTag(tag.tag_id)}
                onMoveToGroup={(tId) => handleMoveItemToGroup(tag.tag_id, "tag", tId)}
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
                groups={currentGroups}
                onRename={(newName) => handleRenamePerson(p.person_id, newName)}
                onDelete={() => handleDeletePerson(p.person_id)}
                onMoveToGroup={(tId) => handleMoveItemToGroup(p.person_id, "person", tId)}
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
                groups={currentGroups}
                onRename={(newName) => handleRenameLocation(loc.location_id, newName)}
                onDelete={() => handleDeleteLocation(loc.location_id)}
                onMoveToGroup={(tId) => handleMoveItemToGroup(loc.location_id, "location", tId)}
                testIdPrefix={`location-${loc.location_id}`}
              />
            ));
          } else if (activeTab === "stickers") {
            const items = filteredStickers.filter((s) => s.group_id === group.group_id);
            count = items.length;
            groupItems = items.map((stk) => (
              <EditableRow
                key={stk.sticker_id}
                icon={Smile}
                emojiContent={stk.content}
                label={stk.name}
                filterType="sticker"
                filterValue={stk.content}
                itemId={stk.sticker_id}
                groupId={group.group_id}
                groups={currentGroups}
                onRename={(newName, newContent) => handleUpdateSticker(stk.sticker_id, newName, newContent)}
                onDelete={() => handleDeleteSticker(stk.sticker_id)}
                onMoveToGroup={(tId) => handleMoveItemToGroup(stk.sticker_id, "sticker", tId)}
                testIdPrefix={`sticker-${stk.sticker_id}`}
              />
            ));
          } else if (activeTab === "phrases") {
            const items = filteredPhrases.filter((p) => p.group_id === group.group_id);
            count = items.length;
            groupItems = items.map((phr) => (
              <EditableRow
                key={phr.phrase_id}
                icon={MessageSquareQuote}
                label={phr.name}
                subLabel={phr.phrase}
                filterType="phrase"
                filterValue={phr.name}
                itemId={phr.phrase_id}
                groupId={group.group_id}
                groups={currentGroups}
                onRename={(newName, newPhraseText) => handleUpdatePhrase(phr.phrase_id, newName, newPhraseText)}
                onDelete={() => handleDeletePhrase(phr.phrase_id)}
                onMoveToGroup={(tId) => handleMoveItemToGroup(phr.phrase_id, "phrase", tId)}
                testIdPrefix={`phrase-${phr.phrase_id}`}
              />
            ));
          }

          return (
            <div
              key={group.group_id}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
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
            e.dataTransfer.dropEffect = "move";
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
                      groups={currentGroups}
                      onRename={(newName) => handleRenameTag(tag.tag_id, newName)}
                      onDelete={() => handleDeleteTag(tag.tag_id)}
                      onMoveToGroup={(tId) => handleMoveItemToGroup(tag.tag_id, "tag", tId)}
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
                      groups={currentGroups}
                      onRename={(newName) => handleRenamePerson(p.person_id, newName)}
                      onDelete={() => handleDeletePerson(p.person_id)}
                      onMoveToGroup={(tId) => handleMoveItemToGroup(p.person_id, "person", tId)}
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
                      groups={currentGroups}
                      onRename={(newName) => handleRenameLocation(loc.location_id, newName)}
                      onDelete={() => handleDeleteLocation(loc.location_id)}
                      onMoveToGroup={(tId) => handleMoveItemToGroup(loc.location_id, "location", tId)}
                      testIdPrefix={`location-${loc.location_id}`}
                    />
                  ))
              )}
            </div>
          )}

          {/* Stickers Tab Ungrouped */}
          {activeTab === "stickers" && (
            <div>
              {filteredStickers.filter((s) => !s.group_id).length === 0 && currentGroups.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground/70 italic space-y-2">
                  <p>{filterQuery ? "Eşleşen sticker/emoji bulunamadı." : "Henüz sticker veya emoji eklenmemiş"}</p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setStickerModalOpen(true)}
                    className="text-xs h-7 gap-1"
                  >
                    <Plus className="w-3.5 h-3.5 text-amber-500" /> Sticker Ekle
                  </Button>
                </div>
              ) : (
                filteredStickers
                  .filter((s) => !s.group_id)
                  .map((stk) => (
                    <EditableRow
                      key={stk.sticker_id}
                      icon={Smile}
                      emojiContent={stk.content}
                      label={stk.name}
                      filterType="sticker"
                      filterValue={stk.content}
                      itemId={stk.sticker_id}
                      groups={currentGroups}
                      onRename={(newName, newContent) => handleUpdateSticker(stk.sticker_id, newName, newContent)}
                      onDelete={() => handleDeleteSticker(stk.sticker_id)}
                      onMoveToGroup={(tId) => handleMoveItemToGroup(stk.sticker_id, "sticker", tId)}
                      testIdPrefix={`sticker-${stk.sticker_id}`}
                    />
                  ))
              )}
            </div>
          )}

          {/* Phrases Tab Ungrouped */}
          {activeTab === "phrases" && (
            <div>
              {filteredPhrases.filter((p) => !p.group_id).length === 0 && currentGroups.length === 0 ? (
                <div className="py-8 text-center text-xs text-muted-foreground/70 italic space-y-2">
                  <p>{filterQuery ? "Eşleşen cümle bulunamadı." : "Henüz cümle veya şablon eklenmemiş"}</p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setPhraseModalOpen(true)}
                    className="text-xs h-7 gap-1"
                  >
                    <Plus className="w-3.5 h-3.5 text-violet-500" /> Cümle Ekle
                  </Button>
                </div>
              ) : (
                filteredPhrases
                  .filter((p) => !p.group_id)
                  .map((phr) => (
                    <EditableRow
                      key={phr.phrase_id}
                      icon={MessageSquareQuote}
                      label={phr.name}
                      subLabel={phr.phrase}
                      filterType="phrase"
                      filterValue={phr.name}
                      itemId={phr.phrase_id}
                      groups={currentGroups}
                      onRename={(newName, newPhraseText) => handleUpdatePhrase(phr.phrase_id, newName, newPhraseText)}
                      onDelete={() => handleDeletePhrase(phr.phrase_id)}
                      onMoveToGroup={(tId) => handleMoveItemToGroup(phr.phrase_id, "phrase", tId)}
                      testIdPrefix={`phrase-${phr.phrase_id}`}
                    />
                  ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Tip footer */}
      <div className="pt-2.5 mt-1.5 border-t border-border/50 text-[10px] text-muted-foreground/80 flex items-center justify-between shrink-0">
        <span>Sürükleyip nota bırakabilir veya tıklayabilirsiniz</span>
      </div>

      {/* Add Sticker / Emoji Dialog */}
      <Dialog open={stickerModalOpen} onOpenChange={setStickerModalOpen}>
        <DialogContent className="max-w-md bg-card border-border p-5">
          <DialogHeader>
            <DialogTitle className="font-serif text-base flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-500" />
              <span>Yeni Sticker / İkon / Emoji Ekle</span>
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleCreateSticker} className="space-y-3.5 pt-2">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Sticker / Emoji Adı</label>
              <Input
                value={newStickerName}
                onChange={(e) => setNewStickerName(e.target.value)}
                placeholder="Örn: Yıldız, Önemli, Kalp, Ateş..."
                autoFocus
                className="text-xs h-8"
              />
            </div>

            <div>
              <label className="text-xs text-muted-foreground block mb-1">Emoji veya Simge İçeriği</label>
              <div className="flex items-center gap-2">
                <Input
                  value={newStickerContent}
                  onChange={(e) => setNewStickerContent(e.target.value)}
                  placeholder="Emoji veya simge girin..."
                  className="text-base h-9 w-24 text-center"
                />
                <div className="text-xs text-muted-foreground flex-1">
                  Seçilen: <span className="text-lg font-mono ml-1">{newStickerContent}</span>
                </div>
              </div>

              {/* Quick Emojis Grid */}
              <div className="mt-2 p-2 bg-muted/40 rounded-lg border border-border/60">
                <div className="text-[10px] text-muted-foreground mb-1.5 font-medium">Hızlı Emoji Seçimi:</div>
                <div className="grid grid-cols-10 gap-1 text-center">
                  {QUICK_EMOJIS.map((em) => (
                    <button
                      key={em}
                      type="button"
                      onClick={() => {
                        setNewStickerContent(em);
                        if (!newStickerName) {
                          const nameMap: Record<string, string> = {
                            "⭐": "Yıldız", "🔥": "Ateş", "🚀": "Roket", "❤️": "Kalp", "🎉": "Kutlama",
                            "💡": "Fikir", "☕": "Kahve", "📌": "Önemli", "✅": "Tamamlandı", "⚠️": "Dikkat",
                            "🎯": "Hedef", "📝": "Not", "🏆": "Başarı", "👍": "Onay", "⚡": "Hızlı"
                          };
                          if (nameMap[em]) setNewStickerName(nameMap[em]);
                        }
                      }}
                      className="hover:scale-125 transition-transform p-0.5 text-base cursor-pointer rounded hover:bg-background"
                    >
                      {em}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {currentGroups.length > 0 && (
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Grup (Opsiyonel)</label>
                <select
                  value={newStickerGroupId || ""}
                  onChange={(e) => setNewStickerGroupId(e.target.value || null)}
                  className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground outline-none"
                >
                  <option value="">— Grupsuz (Serbest) —</option>
                  {currentGroups.map((g) => (
                    <option key={g.group_id} value={g.group_id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <DialogFooter className="pt-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setStickerModalOpen(false)}>
                İptal
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={isSavingSticker || !newStickerName.trim() || !newStickerContent.trim()}
                className="bg-primary text-primary-foreground"
              >
                Kaydet & Ekle
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Add Phrase Dialog */}
      <Dialog open={phraseModalOpen} onOpenChange={setPhraseModalOpen}>
        <DialogContent className="max-w-md bg-card border-border p-5">
          <DialogHeader>
            <DialogTitle className="font-serif text-base flex items-center gap-2">
              <MessageSquareQuote className="w-4 h-4 text-violet-500" />
              <span>Yeni Cümle / Şablon Ekle</span>
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleCreatePhrase} className="space-y-3 pt-2">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Anahtar Sözcük / Başlık</label>
              <Input
                value={newPhraseName}
                onChange={(e) => setNewPhraseName(e.target.value)}
                placeholder="Örn: Toplantı Şablonu, Haftalık Hedef, İmza..."
                autoFocus
                className="text-xs h-8"
              />
            </div>

            <div>
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                <span>Cümle / Metin (Maks. 120 Karakter)</span>
                <span className={`font-mono text-[10px] ${newPhraseText.length > 120 ? "text-destructive font-bold" : ""}`}>
                  {newPhraseText.length} / 120
                </span>
              </div>
              <textarea
                value={newPhraseText}
                onChange={(e) => setNewPhraseText(e.target.value)}
                maxLength={120}
                placeholder="Notlarınıza sık eklediğiniz kısa bir cümle veya şablon metni yazın..."
                className="w-full bg-background border border-border rounded-md p-2 text-xs text-foreground outline-none focus:ring-1 focus:ring-primary h-20 resize-none"
              />
            </div>

            {currentGroups.length > 0 && (
              <div>
                <label className="text-xs text-muted-foreground block mb-1">Grup (Opsiyonel)</label>
                <select
                  value={newPhraseGroupId || ""}
                  onChange={(e) => setNewPhraseGroupId(e.target.value || null)}
                  className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-xs text-foreground outline-none"
                >
                  <option value="">— Grupsuz (Serbest) —</option>
                  {currentGroups.map((g) => (
                    <option key={g.group_id} value={g.group_id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <DialogFooter className="pt-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setPhraseModalOpen(false)}>
                İptal
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={isSavingPhrase || !newPhraseName.trim() || !newPhraseText.trim() || newPhraseText.length > 120}
                className="bg-primary text-primary-foreground"
              >
                Kaydet & Ekle
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Location Picker for adding location */}
      <LocationPicker
        open={locPickerOpen}
        onOpenChange={setLocPickerOpen}
        onSave={async (newLoc) => {
          try {
            await api.post("/locations", newLoc);
            toast.success("Konum eklendi");
            onChange?.();
          } catch (e: any) {
            toast.error(formatApiError(e) || "Konum eklenemedi");
          }
        }}
      />
    </aside>
  );
}
