import {
  Heading1,
  Heading2,
  Heading3,
  CheckSquare,
  Quote,
  Minus,
  Link as LinkIcon,
  Youtube,
  MapPin,
  Image as ImageIcon,
  BellRing,
  CalendarClock,
  LucideIcon,
} from "lucide-react";

export type BlockType =
  | "paragraph"
  | "heading1"
  | "heading2"
  | "heading3"
  | "heading4"
  | "heading5"
  | "heading6"
  | "task"
  | "quote"
  | "divider"
  | "link"
  | "youtube"
  | "gmap"
  | "image"
  | "file"
  | "reminder"
  | "timeslot";

export interface BlockOption {
  type: BlockType;
  label: string;
  desc?: string;
  hint?: string;
  icon: LucideIcon;
}

export const BLOCK_OPTIONS: BlockOption[] = [
  { type: "heading1", label: "Başlık 1", hint: "# Başlık", desc: "Büyük ana başlık", icon: Heading1 },
  { type: "heading2", label: "Başlık 2", hint: "## Alt başlık", desc: "Orta alt başlık", icon: Heading2 },
  { type: "heading3", label: "Başlık 3", hint: "### Küçük başlık", desc: "Küçük alt başlık", icon: Heading3 },
  { type: "task", label: "Görev Listesi", hint: "- [ ] Görev", desc: "Onay kutulu yapılacak madde", icon: CheckSquare },
  { type: "quote", label: "Alıntı", hint: "> Alıntı metni", desc: "Vurgulanmış blok alıntı", icon: Quote },
  { type: "divider", label: "Ayırıcı Çizgi", hint: "---", desc: "Yatay ayırıcı", icon: Minus },
  { type: "timeslot", label: "Zaman Bloğu (Time Slot)", hint: "```timeslot", desc: "Süre hesaplamalı zaman aralığı ve aktivite", icon: CalendarClock },
  { type: "image", label: "Görsel Yükle", hint: "![...](...)", desc: "Resim veya ekran görüntüsü ekle", icon: ImageIcon },
  { type: "file", label: "Dosya / Belge Yükle", hint: "[Belge](...)", desc: "PDF, TXT, DOCX, MP4 vb. dosya ekle", icon: LinkIcon },
  { type: "reminder", label: "Hatırlatma", hint: "```reminder", desc: "Tarihli ve saatli anımsatıcı", icon: BellRing },
  { type: "link", label: "Bağlantı", hint: "[Metin](url)", desc: "Web sitesi linki ekle", icon: LinkIcon },
  { type: "youtube", label: "YouTube Videosu", hint: "https://youtube.com/...", desc: "Gömülü video oynatıcı", icon: Youtube },
  { type: "gmap", label: "Google Harita", hint: "https://maps.google.com/...", desc: "Etkileşimli harita konumu", icon: MapPin },
];

export function filterBlockOptions(query: string): BlockOption[] {
  const q = query.toLowerCase().trim();
  if (!q) return BLOCK_OPTIONS;
  return BLOCK_OPTIONS.filter(
    (b) =>
      b.label.toLowerCase().includes(q) ||
      b.type.toLowerCase().includes(q) ||
      (b.hint && b.hint.toLowerCase().includes(q)) ||
      (b.desc && b.desc.toLowerCase().includes(q))
  );
}
