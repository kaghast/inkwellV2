# Inkwell — UX Redesign Plan

Goal: calm, minimal and dense without clutter. Capture is the most prominent element on every screen. Keyboard-first, accessible and responsive. Built on the existing Tailwind tokens (`--background`, `--card`, `--primary`, …), Radix primitives and shadcn components; the existing serif headline + Manrope body + JetBrains Mono for metadata stays.

User-facing text is Turkish.

---

## 1. Navigation

The current icon rail (`AppMenubar`, `w-16`) lists six destinations flat. The new rail keeps the same width and position (so every page layout `pt-14 lg:pl-16` keeps working) and groups destinations:

| Rail item | Route | Contents |
| --- | --- | --- |
| Bugün (Today, home) | `/` | Daily note, timeline, tasks, week/month notes, calendar, captures. The separate Home page was removed (2026-11-24); `/today` and `/home` redirect here |
| Gelen kutusu (Inbox) | `/inbox` | Captures awaiting review; badge = ready + failed count |
| Bugün (Today) | `/today` | Daily note, timeline, tasks, reminders, the day's captures |
| Bilgi (Knowledge) | `/all-notes` | All objects, filter by type/space |
| Keşfet ▸ (Explore) | flyout | Alan haritası `/graph`, Ağ `/network`, Harita `/map`, Zaman çizelgesi `/timeline`, Günlük akış `/feed` |
| İş ▸ (Work) | flyout | Kanban `/kanban`, open tasks (Today) |
| Bölümler (Spaces) | `/spaces` | Spaces, their object counts, defaults. Named "Bölümler" because "Alanlar" already means Areas in the UI |
| Ayarlar | `/settings` | Existing settings; object types tab renamed "Nesne tipleri" |

Flyouts open on click and on keyboard focus (Radix DropdownMenu, so arrow keys and Esc work). The mobile drawer shows the same groups as headed lists. The AI section joins in Phase 2.

The old daily feed (previously `/`) moves to `/feed`; `/day/:date`, `/week/:date`, `/month/:date` and all other routes keep working unchanged.

## 2. Universal capture

- **Header capture bar** — "Aklında ne var?" is the first thing in the header on every page (left side, where the header was empty). One line, grows to a textarea on focus.
  - `Enter` → saved to the Inbox immediately (optimistic toast "Gelen kutusuna eklendi"), processed in the background.
  - `Ctrl/⌘+Enter` → saved directly as a note without AI and opened.
  - `Shift+Enter` → newline.
  - Pasting a URL shows a chip "Bağlantı olarak yakalanacak"; pasting long text shows "Alıntı / makale olarak işlenecek". The user never has to choose a type.
  - Paperclip button → file capture (any supported type) into the Inbox.
- **Shortcuts** (only when focus is not in an editable field, so the editors and browser keep theirs):
  - `c` focus capture, `/` open the palette in search mode, `Ctrl/⌘+K` open the palette from anywhere (pages may override this in Chrome/Edge/Firefox), `g` then `h`/`i`/`t` go to Home/Inbox/Today.
  - We avoid `Ctrl+N/T/W/J/L/D/S/P`, which browsers reserve or users expect.

## 3. Command palette

`cmdk` (already a dependency) in a Radix dialog. Groups: **Eylemler** (Yakala, Yeni not, Hızlı görev, Bugünün notu, Şablondan oluştur), **Git** (each nav destination, each Space), **Ara** (live results from `/api/search`, grouped by type, with snippet), **Son aramalar** (localStorage, per device, clearable). Typing `>` filters to actions only. Quick task: "Görev: …" creates a Card/Task object.

## 4. Inbox review

Dense list, one row per capture: status pill (Yeni / İşleniyor / İncelemeye hazır / İşlendi / Hata), detected type with icon, suggested title, two-line raw preview, source (yazı, bağlantı, dosya), time. Selecting a row opens an inline review panel on the right (no modal):

- Suggested title, type (select), summary, tags, people, dates, extracted tasks (checkboxes), related objects with the reason, provider badge ("Kural tabanlı" or "Gemini").
- Actions: **Tümünü kabul et** (primary), **Düzenle** (fields become editable inline), **Yapay zekasız kaydet**, **Reddet**; failed rows show **Tekrar dene** and the error.
- Batch: checkbox column + "Seçilenleri kabul et". Keyboard: `j/k` move, `a` accept, `e` edit, `r` reject, `s` save raw.
- Empty state explains the loop in one sentence and focuses the capture bar.

## 5. Today

Two columns on desktop, one on mobile: left = the daily note (existing markdown editor via the note page link, plus a quick-append box), right = day timeline built from ```timeslot blocks of that day's notes, open tasks (checkboxes toggle through the existing `/api/notes/:id/tasks`), reminders, the day's captures, and objects created/updated today. The date can be moved with ← / → buttons. No AI summary in Phase 1; the Phase 2 end-of-day review will cite only these items.

## 6. Home

Order by importance: capture (large), Inbox summary ("3 öğe incelemeni bekliyor"), Today snapshot (open tasks, next reminder), recent objects, "Bağlantı önerileri" (pending relation suggestions from processed captures), activation checklist ("İlk 7 gün": 5 nesne, 2 ilişki, 1 geri bağlantı, 1 yakalama — real counts; the Ask Inkwell step joins in Phase 2). Checklist hides itself once complete.

## 7. Object page additions

Below the content: **İlişkiler** panel — outgoing and incoming typed relations grouped by relation label, each a link with the object's type icon; wikilink-derived ones are marked "[[ ]]" and can only be removed by editing the text; "İlişki ekle" opens an inline search + relation type picker (including "Yeni ilişki tipi…"). Backlinks are the incoming group.

## 8. Design system rules

- Spacing scale 4/8/12/16/24; cards `rounded-lg border bg-card`, no heavy shadows.
- Status colours from tokens: new = muted, processing = primary (pulse), ready = amber, processed = emerald, failed = destructive.
- Type icons come from the type's `icon` (lucide name) and `color`, shared helper `TypeIcon`.
- Every interactive element is a real `button`/`a`, has a visible focus ring (`focus-visible:ring-2 ring-ring`), and an `aria-label` when icon-only.
- Lists virtualise only when they exceed a few hundred rows (not needed in Phase 1).
- Empty states: one sentence + one primary action, no illustrations.
- Few modals: review, relations and quick-append are inline; only the palette, templates and destructive confirmations are dialogs.

## 9. Onboarding

Phase 1 ships the Home activation checklist ("İlk adımlar"), computed from real data, which hides itself once every step is done, and the large capture entry at the top of Home. No product tour overlay.

Planned, not yet built: a pulsing first-run hint on the capture bar and a one-time animation on the Inbox badge after the first capture.

## 10. Implementation status (Phase 1)

Built and verified in the browser: grouped rail with Explore/Work flyouts and Inbox badge; header capture bar (`c`, Enter → Inbox, Ctrl/⌘+Enter → note, paste/attach files); command palette (`Ctrl/⌘+K`, `/`, `g h|i|t|k|s`, quick task, templates, recent searches); Home; Inbox review (accept, edit, save raw, reject, retry, batch, J/K/A/E/S/R); Today (daily note, timeslot timeline, tasks, reminders, captures, add-to-day); Bölümler (Spaces) list/detail; İlişkiler panel with Bölüm picker; template dialog. Mobile (375 px) has no horizontal scroll.

Old daily feed moved from `/` to `/feed`; every other route is unchanged.
