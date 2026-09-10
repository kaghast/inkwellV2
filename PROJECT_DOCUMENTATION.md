# 🖋️ Inkwell V2 — Kapsamlı Proje Dokümantasyonu

Bu belge, **Inkwell V2** projesinin başlangıcından bugüne kadar gerçekleştirilen tüm geliştirme adımlarını, sistemin teknolojik altyapısını, veritabanı mimarisini, özel motorlarını ve veri modellerini ayrıntılı olarak içermektedir.

---

## 📑 İçindekiler
1. [Proje Özeti ve Vizyon](#1-proje-özeti-ve-vizyon)
2. [Teknolojik Altyapı ve Sistem Mimarisi](#2-teknolojik-altyapı-ve-sistem-mimarisi)
3. [Veritabanı Mimarisi ve Veri Modeli](#3-veritabanı-mimarisi-ve-veri-modeli)
4. [Özel Motorlar ve Bileşen Mimarisi](#4-özel-motorlar-ve-bileşen-mimarisi)
5. [Gün Gün Kronolojik Geliştirme Günlüğü](#5-gün-gün-kronolojik-geliştirme-günlüğü)
6. [Dağıtım ve DevOps Yapılandırması](#6-dağıtım-ve-devops-yapılandırması)

---

## 1. Proje Özeti ve Vizyon

**Inkwell V2**, modern bilgi yönetimi, zihin haritalama, görsel çizim, hiyerarşik taslak çıkarma ve lokasyon bazlı not tutma ihtiyaçlarını tek bir çatıda birleştiren **Next-Generation Personal Knowledge Management (PKM)** platformudur.

### Temel Yetenekler:
- **4'ü 1 Arada Not Motoru:** Zengin Markdown metin, Excalidraw benzeri serbest vektörel çizim tuvali, sürükle-bırak hiyerarşik taslak (Outline) üreticisi ve etkileşimli **Zihin Haritası (Mindmap)** motoru.
- **İki Yönlü Bağlantılar & Bilgi Ağı:** `[[Not Adı]]` sözdizimi ile notlar arası çift yönlü wikilink bağlantıları, referans listeleri ve 2D/3D Etkileşimli Ağ Grafiği (Graph View).
- **Kanban & Görev Yönetimi:** Not tipleriyle entegre, dinamik kolonlu görsel iş akış panosu.
- **Akıllı Harita & Canlı Konum:** Çift motorlu harita (Google Maps + Leaflet / OpenStreetMap), GPS otomatik konum tespiti ve Nominatim destekli küresel canlı arama.
- **Gelişmiş Organizasyon:** Sola sabit modern menubar, "+ Yeni Not Ekle" hızlı erişimi ve çoklu sekmede (Etiketler, Kişiler, Konumlar) sürükle-bırak destekli hiyerarşik klasör/grup yönetimi.
- **Blok Tabanlı Not İşleme:** Notu Kes (Split Note) ve Notu Birleştir (Merge Note) dinamik blokları ile kesintisiz not parçalama ve zengin metadata aktarımıyla not birleştirme.
- **Yapay Zeka ve Vektör Arama:** Google Gemini ve pgvector 768 boyutlu metin embedding'leri ile anlamsal arama ve otomatik özetleme.

---

## 2. Teknolojik Altyapı ve Sistem Mimarisi

```mermaid
graph TD
    Client["İstemci (React 18 + TypeScript + Vite)"] -->|REST API & JSON| Server["Sunucu (Node.js + Express + TSX)"]
    Server -->|Drizzle ORM| DB[("PostgreSQL / PGlite (pgvector)")]
    Server -->|Google GenAI SDK| Gemini["Google Gemini AI API"]
    Client -->|Maps SDK / Tiles| Maps["Google Maps & OpenStreetMap / CartoDB"]
    Client -->|Auth State| Firebase["Firebase / Google OAuth"]
    Server -->|Local File System| Disk["Kalıcı Disk Depolama (/data/uploads)"]
```

### 2.1. Frontend Mimarisi
- **Çekirdek:** React 18, TypeScript, Vite.
- **Stil & Tasarım:** Tailwind CSS, Tailwind Animate, PostCSS.
- **Bileşen Kütüphanesi:** Radix UI Primitives (Dialog, Dropdown, Tabs, Popover, Progress, Checkbox, Sheet, Tooltip vb.).
- **İkonografi:** Lucide React.
- **Yönlendirme & Durum:** React Router v6, React Context API (`FilterContext`, `AuthContext`), SWR & React Hook Form.
- **Markdown İşleme:** `react-markdown`, `remark-gfm` (Tablolar, checklist'ler, otomatik URL algılama ve kelime kaydırma koruması).
- **Görselleştirme & Zihin Haritası:** SVG Bézier Curve Mindmap Engine, Recharts, Force-directed 2D Canvas Graph Engine.
- **Harita Motoru:** `@vis.gl/react-google-maps`, Leaflet, React-Leaflet, CartoDB Voyager ve OSM Nominatim Geocoder.

### 2.2. Backend Mimarisi
- **Çalışma Ortamı:** Node.js, `tsx` (TypeScript Execution Engine).
- **Web Çerçevesi:** Express.js (REST API, CORS, Cookie Parser, JSON Middleware).
- **Veritabanı Katmanı:** Drizzle ORM (Tip güvenli SQL sorguları, şema yönetimi, migrasyonlar).
- **Veritabanı Motoru:** 
  - *Üretim Ortamı:* PostgreSQL 16+ (`pg` sürücüsü, pgvector eklentisi).
  - *Yerel / Fallback Ortamı:* `@electric-sql/pglite` (WebAssembly & in-memory/embedded PostgreSQL).
- **Dosya Depolama:** `multer` ile çok parçalı yüklemeler, veritabanında Base64 yedekleme ve disk üzerinde `/data/uploads` kalıcı birim eşlemesi.
- **Kimlik Doğrulama:** JWT (JSON Web Tokens), `bcryptjs`, Google OAuth 2.0.

---

## 3. Veritabanı Mimarisi ve Veri Modeli

Inkwell V2, ilişkisel bütünlüğü ve performansı ön planda tutan PostgreSQL tabanlı bir şema kullanır. Drizzle ORM ile tanımlanmış şema yapısı aşağıda özetlenmiştir:

### 3.1. Varlık İlişki Diyagramı (ER Diagram)

```mermaid
erDiagram
    USERS ||--o{ NOTES : owns
    USERS ||--o{ NOTE_TYPES : defines
    USERS ||--o{ ITEM_GROUPS : manages
    USERS ||--o{ TAGS : creates
    USERS ||--o{ PEOPLE : creates
    USERS ||--o{ LOCATIONS : creates
    USERS ||--o{ KANBAN_COLUMNS : defines
    USERS ||--o{ REMINDERS : schedules
    USERS ||--o{ FILES : uploads

    ITEM_GROUPS ||--o{ TAGS : groups
    ITEM_GROUPS ||--o{ PEOPLE : groups
    ITEM_GROUPS ||--o{ LOCATIONS : groups

    NOTE_TYPES ||--o{ NOTES : categorizes
    LOCATIONS ||--o{ NOTES : locates
    NOTES ||--o{ REMINDERS : triggers
```

### 3.2. Veritabanı Tabloları ve Alanları

#### `users` (Kullanıcılar)
| Alan Adı | Tip | Açıklama |
| :--- | :--- | :--- |
| `user_id` | `text` (PK) | Benzersiz kullanıcı kimliği |
| `email` | `text` (Unique) | E-posta adresi |
| `name` | `text` | Ad Soyad |
| `picture` | `text` | Profil resmi URL'i |
| `password_hash` | `text` | Şifrelenmiş parola (yerel hesaplar için) |
| `auth_provider` | `text` | Kimlik sağlayıcı (`email`, `google`) |
| `created_at` | `timestamp` | Kayıt tarihi |
| `updated_at` | `timestamp` | Son güncelleme |

#### `notes` (Notlar, Çizim, Outline ve Zihin Haritası İçerikleri)
| Alan Adı | Tip | Açıklama |
| :--- | :--- | :--- |
| `note_id` | `text` (PK) | Benzersiz not kimliği |
| `user_id` | `text` (FK -> users) | Notun sahibi |
| `slug` | `text` (Index) | SEO ve doğrudan erişim bağlantı adı |
| `title` | `text` | Not başlığı |
| `content` | `text` | Markdown metin / Vektör Çizim / Outline / Zihin Haritası verisi |
| `date` | `text` (Index) | ISO Tarih damgası |
| `tags` | `jsonb` (`string[]`) | Not etiketleri dizisi |
| `people` | `jsonb` (`string[]`) | Bahsedilen kişiler (`@isim`) |
| `location_id` | `text` (FK -> locations) | Bağlı coğrafi konum |
| `note_type_id` | `text` (FK -> note_types) | Not tipi (Düz Not, Toplantı, Kart vb.) |
| `custom_fields` | `jsonb` | Dinamik not tipi alan değerleri |
| `pinned` | `boolean` | Sabitlenmiş not durumu |
| `archived` | `boolean` | Arşivlenmiş not durumu (Varsayılan: `false`) |
| `is_encrypted` | `boolean` | Parola korumalı şifreli not durumu (Varsayılan: `false`) |
| `password_hash` | `text` | Güvenli SHA-256 + Salt parola özeti |
| `embedding` | `vector(768)` | AI Anlamsal arama vektör verisi |
| `ai_summary` | `text` | Yapay zeka tarafından üretilen özet |
| `created_at` / `updated_at` | `timestamp` | Oluşturma ve güncelleme zamanları |

#### `item_groups` (Öğe Grupları / Klasörler)
| Alan Adı | Tip | Açıklama |
| :--- | :--- | :--- |
| `group_id` | `text` (PK) | Benzersiz grup kimliği |
| `user_id` | `text` (FK -> users) | Grup sahibi |
| `name` | `text` | Grup adı |
| `type` | `text` | Grup türü (`tags`, `people`, `locations`) |
| `color` | `text` | HEX renk kodu |
| `created_at` / `updated_at` | `timestamp` | Zaman damgaları |

#### `note_types` (Dinamik Not Tipleri)
| Alan Adı | Tip | Açıklama |
| :--- | :--- | :--- |
| `type_id` | `text` (PK) | Tip kimliği (`type_plain`, `type_card` vb.) |
| `user_id` | `text` (FK -> users) | Özel not tipi oluşturan kullanıcı |
| `name` | `text` | Not tipi adı |
| `description` | `text` | Açıklama |
| `color` / `icon` | `text` | Renk ve Lucide ikon adı |
| `is_default` | `boolean` | Sistem varsayılanı mı? |
| `fields` | `jsonb` (`NoteTypeField[]`)| Dinamik form alanları (Tarih aralığı, dropdown, sayı vb.) |

#### `locations` (Kayıtlı Lokasyonlar)
| Alan Adı | Tip | Açıklama |
| :--- | :--- | :--- |
| `location_id` | `text` (PK) | Benzersiz konum kimliği |
| `user_id` | `text` (FK -> users) | Konum sahibi |
| `name` | `text` | Lokasyon adı (Örn: "Ofis", "Kadıköy") |
| `lat` / `lng` | `doublePrecision` | Enlem ve Boylam koordinatları |
| `group_id` | `text` (FK -> item_groups) | Bağlı olduğu grup/klasör |

#### `note_versions` (Not Versiyon Geçmişi & Değişiklik Günlüğü)
| Alan Adı | Tip | Açıklama |
| :--- | :--- | :--- |
| `version_id` | `text` (PK) | Benzersiz versiyon kimliği |
| `note_id` | `text` (FK -> notes) | Bağlı ana not kimliği |
| `user_id` | `text` (FK -> users) | Değişikliği yapan kullanıcı |
| `version_number` | `integer` | Sıralı versiyon numarası (`1`, `2`, `3`...) |
| `title` | `text` | İlgili versiyondaki başlık |
| `content` | `text` | İlgili versiyondaki Markdown/Çizim/Outline/Mindmap içeriği |
| `date` | `text` | ISO Tarih damgası |
| `tags` | `jsonb` (`string[]`) | Etiketler dizisi |
| `people` | `jsonb` (`string[]`) | Bahsedilen kişiler |
| `location_id` | `text` (FK -> locations) | Bağlı coğrafi konum |
| `note_type_id` | `text` (FK -> note_types) | Not tipi |
| `custom_fields` | `jsonb` | Dinamik alan değerleri |
| `change_summary` | `text` | Değişiklik açıklaması/özeti |
| `is_encrypted` | `boolean` | Şifreli not durumu |
| `password_hash` | `text` | Parola hash özeti |
| `created_at` | `timestamp` | Versiyon oluşturulma anı |

#### `tags` & `people` (Etiketler ve Kişiler)
- `tags`: `tag_id`, `user_id`, `name`, `group_id`, `created_at`
- `people`: `person_id`, `user_id`, `name`, `group_id`, `created_at`

#### `kanban_columns` & `reminders` & `files`
- `kanban_columns`: `column_id`, `user_id`, `name`, `color`, `order_index`.
- `reminders`: `reminder_id`, `user_id`, `note_id`, `at`, `text`, `fired`, `fired_at`.
- `files`: `file_id`, `user_id`, `original_filename`, `content_type`, `size`, `data_base64`, `is_deleted`.

---

## 4. Özel Motorlar ve Bileşen Mimarisi

### 4.1. 4'ü 1 Arada Not Formatı Serileştirme Standardı
Tüm not tipleri saf Markdown uyumlu olarak tek bir `content` sütununda saklanır:
1. **Zengin Markdown:** Standart GFM markdown metinleri, başlıklar, listeler ve `[[wikilink]]` referansları.
2. **Vektörel Çizim Tuvali (Drawing):** 
```drawing
{
  "version": 1,
  "elements": [
    { "id": "1", "type": "rectangle", "x": 100, "y": 80, "width": 120, "height": 60, "strokeColor": "#3b82f6" }
  ],
  "gridMode": "dots"
}
```
3. **Hiyerarşik Taslak (Outline Generator):**
```markdown
- [ ] 1. Proje Analizi ve Gereksinimler
  - [x] 1.1 Veritabanı Şemasının Hazırlanması
  - [-] 1.2 Arayüz Mockup Tasarımları
- [•] 2. Uygulama Geliştirme Aşaması
```
4. **Zihin Haritası (Mindmap Engine):**
```mindmap
# Ana Fikir / Proje Başlığı
- [blue] Araştırma ve Analiz
  - Rakip İncelemesi
  - Kullanıcı Görüşmeleri
- [amber] Mimari ve Altyapı
  - Veritabanı Şeması
  - Güvenlik ve Şifreleme
- [emerald] Arayüz ve Tasarım
  - [rose] Mobil Menubar
```

### 4.2. Dördüncü İçerik Modu: Zihin Haritası (Mindmap) Motoru
- **Çift Yönlü Ayrıştırıcı (`src/lib/mindmapParser.ts`):** Zihin haritaları hiyerarşik Markdown (`#`, `##`, `-`) ve `MindmapNode` ağacı arasında kayıpsız dönüştürülür. Düğüm renkleri `[blue]`, `[emerald]`, `[amber]`, `[purple]`, `[rose]` gibi etiketlerle markdown'a gömülür.
- **Etkileşimli Editör (`MindmapEditor.tsx`):**
  - Gerçek zamanlı dinamik genişlik ve Bézier eğrisi bağlantıları.
  - Alt dal (`+ Dal Ekle`), kardeş düğüm ekleme, düğüm silme, dal katlama/açma (`toggle collapse`).
  - Hızlı renk seçici paleti, düğüm üzerinde anında metin düzenleme (inline editing).
  - Tuval üzerinde Pan / Zoom (yakınlaştırma/uzaklaştırma), merkeze sıfırlama ve yüksek kaliteli SVG dışa aktarma (export).
  - Canlı Markdown taslak sekmesi ile anında ham metin senkronizasyonu.
- **Görsel Görüntüleyici (`MindmapViewer.tsx`):** Not kartlarında (`NoteCard.tsx`), not detayında (`NoteDetail.tsx`) ve Markdown kod bloklarında (`MarkdownView.tsx`) zihin haritalarını kompakt ve şık SVG ağaçları olarak canlı görselleştirir.

### 4.3. Üst Header ve Sol İkon Menü Çubuğu Mimarisi
- **Üst Header (`fixed top-0 left-0 lg:left-16 right-0 h-14`):**
  - Tüm sayfalarda üstte sabitlenmiş modern başlık çubuğu.
  - **Sağ Tarafta:** Inkwell Logosu ve Başlığı ("Inkwell" + tüy ikonu), Bildirimler & Hatırlatmalar dropdown menüsü, Tema değiştirici (Güneş/Ay) ve Kişisel Menü (Kullanıcı avatarı, e-posta, ayarlar ve çıkış).
  - **Sol Tarafta:** Mobil cihazlar için açılır menü (drawer) butonu.
- **Sol Bar (Sadece İkon Menü - `w-16 fixed left-0 top-0 bottom-0`):**
  - Masaüstü görünümünde `w-16` kompakt dikey menubar.
  - Üstte hızlı **"+ Yeni Not Ekle"** ikon butonu (`Plus`).
  - Ortada dikey gezinme ikonları: *Günlük Akış* (`/`), *Bütün Notlar* (`/all-notes`), *Ağ Görünümü* (`/graph`), *Harita* (`/map`), *Kanban* (`/kanban`).
  - Altta *Ayarlar* (`/settings`) ikon butonu.
  - Her ikon için zengin CSS floating hover tooltip ve sol kenar aktiflik indikatörü.
  - Sayfa içerikleri `pt-14 lg:pl-16` düzeni ile header ve sol bar ile kusursuz hizalanmıştır.
- **Temiz Yeni Not Ekleme Sayfası (`src/pages/NewNotePage.tsx`):**
  - `/new` ve `/notes/new` rotalarında çalışan, dikkat dağıtıcı unsurlardan arındırılmış tam özellikli not editörü.
  - 4 içerik modu seçimi (Markdown, Çizim, Outline, Zihin Haritası), başlık, tarih, konum, dinamik not tipi alanları, parola korumalı şifreleme ve Tam Odaklanma Modu (Full Focus Mode) desteği.

### 4.4. Notu Kes (Split) ve Notu Birleştir (Merge) Blokları
- **Notu Kes (Split Note) Bloğu (`src/lib/splitMerge.ts` & `SplitNoteDialog.tsx`):**
  - İçerikte imlecin bulunduğu veya seçilen ayrım noktasına `<!-- inkwell:split-note -->` bloğu yerleştirilir.
  - Not kaydedildiğinde veya onaylandığında, ayrım noktasından önceki kısım mevcut notta kalır; sonraki kısım ise aynı etiket, kişi ve konum bilgileriyle yeni bir not olarak sisteme eklenir (`POST /notes`).
- **Notu Birleştir (Merge Note) Bloğu (`MergeNoteDialog.tsx`):**
  - Editörden "Notu Birleştir" seçildiğinde kullanıcının diğer notları aranabilir modalda listelenir (veya içerikteki `[[...]]` referansı seçilebilir).
  - Birleştirilen notun Markdown içeriği, konumu, etiketleri, kişileri, oluşturulma tarihi ve özel alanları mevcut notun altına zengin formatlanmış bir alıntı ve metadata bloğu olarak eklenir.
  - Birleştirme işlemi başarıyla tamamlandığında kaynak not veritabanından güvenli biçimde silinir (`DELETE /notes/:note_id`).

### 4.5. Not Şifreleme ve Kilit Mekanizması (Web Crypto API)
- **Kriptografik Güvenlik:** Parolalar SHA-256 ve 16-byte rastgele salt ile hashlenir (`src/lib/crypto.ts`). Parolanın kendisi asla düz metin olarak iletilmez veya saklanmaz.
- **Kilit Ekranı ve İçerik Koruma:** Şifreli notlar (`is_encrypted: true`), istemcide parola girilip doğrulanana kadar Markdown içeriğini, çizimleri, etiketleri ve gömülü yorumları gizler.
- **Kesintisiz Arama ve Takvim Uyumluluğu:** Not içeriği, başlığı ve etiketleri arka uç arama indeksinde (`GET /notes?q=...`) ve takvim filtrelerinde listelenmeye devam eder.

### 4.6. Genel Dosya ve Belge Yönetimi
- **Evrensel Format Desteği:** PDF, TXT, DOCX, XLSX, PPTX, MP4, MP3, ZIP vb. tüm yaygın dosya tipleri desteklenir (`FileUploadDialog.tsx`).
- **Markdown Entegrasyonu & Yeni Sekmede Açılma:** Yüklenen dosyalar metin içerisine `[📄 dosya_adi.pdf](/api/files/:file_id)` formatında yerleştirilir ve tıklandığında `target="_blank" rel="noreferrer"` ile yeni sekmede açılır.
- **Dinamik MIME ve Inline Dağıtım:** Sunucu tarafında `GET /files/:file_id` endpoint'i doğru `Content-Type` ve `Content-Disposition: inline` başlıklarıyla yanıt verir.

### 4.7. Gömülü Yorumlar ve Dinamik Etkileşim
- **İsteğe Bağlı (On-Demand) Yorum Formu:** Yorum ekleme alanı varsayılan olarak gizlidir; "Yorum Ekle" butonu ile açılır ve "İptal" veya başarılı gönderim ile kapanır (`NoteCommentsSection.tsx`).
- **Takvim Rozet Entegrasyonu:** Yorum tarihleri ayıklanarak dashboard takvim rozet sayımlarına ve gün bazlı filtrelere dahil edilir.

### 4.8. Kesintisiz CTRL+S Hızlı Kaydetme Motoru
- **Tüm İçerik Modlarında Kesintisiz Kayıt:** Kullanıcı *Metin (Markdown)*, *Çizim & Şema (Canvas)*, *Hiyerarşik Outline* veya *Zihin Haritası (Mindmap)* modlarından hangisinde çalışırsa çalışsın, `CTRL+S` (Mac için `Cmd+S`) yapıldığında düzenleme oturumundan (`editing: true`) çıkılmaksızın ve odak kaybolmaksızın not arka planda veritabanına (`PUT /notes/:id`) ve versiyon geçmişine kaydedilir.
- **Yeni Not Ekleme Akışında Kesintisiz Oturum (`NewNotePage.tsx`):** Yeni not oluştururken basılan ilk `CTRL+S`, notu veritabanında oluşturur (`POST /notes`) ve rota durumunu sessizce günceller; kullanıcının yazma/çizme akışını kesmeden sonraki tüm `CTRL+S` eylemleri mevcut notu güncellemeye (`PUT /notes/:id`) devam eder.
- **Evrensel Kısayol Yakalama:** Editör içindeki metin kutuları, tuval veya başlık alanlarında tarayıcının varsayılan sayfa kaydetme diyaloğu engellenerek anında sistem kayıt mekanizması tetiklenir.

---

## 5. Gün Gün Kronolojik Geliştirme Günlüğü

### 📅 19 Ağustos 2026
- **Proje Temelleri ve Depo Başlatma:**
  - `inkwellV2` projesinin temel yapısı kuruldu, Vite ve React ortamı oluşturuldu (`74d3ce3`).
  - Tailwind CSS temaları, Bricolage Grotesque ve JetBrains Mono yazı tipleri ile kağıt dokusu (`paper`) arayüz temeli entegre edildi.

---

### 📅 20 Ağustos 2026 (Ana Geliştirme & Dönüm Noktaları)

#### 09:00 - 12:00: Kimlik Doğrulama, PGlite ve Ağ Grafiği (Graph View)
- **OAuth & Veritabanı Esnekliği:**
  - Google OAuth girişi ve yerel e-posta/şifre doğrulaması güçlendirildi (`4ecc2d1`).
  - Yerel geliştirme için embedded PostgreSQL (`PGlite`) desteği eklendi (`5a3966f`).
- **Ağ Grafiği (Graph View) & Wikilink Motoru:**
  - `[[Not Adı]]` sözdizimi ile notlar arasında iki yönlü referanslama altyapısı kuruldu (`a2ba599`).
  - Notlar arası ilişkileri 2D etkileşimli yerçekimi tabanlı canvas üzerinde görselleştiren **Graph View** sayfası geliştirildi.
  - Kanban panosu ile 'Kart' not tipi arasında tam senkronizasyon sağlandı (`e9c2806`, `15649c1`).

#### 12:00 - 15:00: Dağıtım Altyapısı, Kalıcı Depolama ve Harita Entegrasyonu
- **Coolify & Docker Yapılandırması:**
  - Üretim ortamı için optimize edilmiş çok aşamalı (multi-stage) `Dockerfile`, Docker healthcheck ve kalıcı disk birimi (`DATA_DIR`) entegre edildi (`a9ace08`, `92fb5b6`, `bb5927a`).
- **Harita & GPS Geliştirmeleri:**
  - Google Maps Platform API anahtarı girilmediğinde devreye giren modern **Leaflet/CartoDB Voyager** harita motoru geliştirildi (`0636141`).
  - Tarayıcı GPS servisiyle mevcut konum tespiti ve tek tıkla GPS koordinatına not yazma özelliği eklendi (`a535610`).
  - Not detay sayfasının altına o nota referans veren (`[[...]]`) tüm ilişkili notları listeleyen bölüm eklendi (`3e8724c`).

#### 15:00 - 17:00: 3'ü 1 Arada Not Motoru, Sadeleştirme ve Hata Düzeltmeleri
- **3'ü 1 Arada Not Editörü & Görüntüleyicisi:**
  - Not detay sayfasına **Markdown**, **Excalidraw benzeri Vektörel Çizim Tuvali** ve **Sürükle-Bırak Hiyerarşik Outline Generator** modları eklendi (`3e66582`).
  - Çizimlerin dashboard ve not kartları listesinde canlı vektör olarak önizlenmesi sağlandı.
- **Kategori Modelinin Kaldırılması & Sidebar Gruplama:**
  - Not veri modelinden kategori seçeneği tamamen çıkarılarak sadeleştirildi.
  - Sol kenar çubuğunda (Sidebar) Etiket, Kişi ve Konumlar için sürükle-bırak ve 1-tık klasör gruplama özelliği tamamlandı (`6ae878c`).
- **Harita Arama & Katman Hatalarının Giderilmesi:**
  - Harita üzerinde Google Maps benzeri gerçek zamanlı arama barı ve üst kontrol araç çubuğu oluşturuldu (`01d1c41`, `41b0f7b`).
  - Arama açılır menüsünün haritanın arkasında kalması sorunu `z-[2000]` katmanlama ve overflow düzenlemeleri ile çözüldü (`2d4d44a`).
  - Not detayında kalan eski kategori referansı giderildi (`0c11a40`).
  - Markdown içerisindeki `http://` satırlarının otomatik linklenmesi ve uzun kelimelerin kutuya sığdırılması (`overflow-wrap: anywhere`) tamamlandı (`7f16ddf`).

---

### 📅 21 Ağustos 2026
- **Kapsamlı Proje Dokümantasyonu ve Sistem Mimarisi:**
  - Tüm teknolojik bileşenlerin, veri modellerinin ve kronolojik geçmişin eksiksiz olarak `PROJECT_DOCUMENTATION.md` dosyasına işlenmesi tamamlandı (`b7a7432`).
- **Sunucu Taraflı Arama, Sayfalama ve Listeleme Performansı:**
  - `server.ts` içerisindeki `/notes` endpoint'i `q` parametresi ile başlık, içerik, etiket ve kişi alanlarını doğrudan arka uçta (backend) filtreleyecek şekilde güncellendi.
  - Not listeleri 10'arlı gruplara bölündü (`limit=10`, `offset=0, 10, 20...`, `paginate=true`).
  - Listenin sonuna gelindiğinde yeni 10 notu dinamik olarak çeken şık "Daha Fazla Yükle (Load More)" mekanizması `AllNotes.tsx` ve `Dashboard.tsx` sayfalarına entegre edildi.
- **Not Arşivleme & Kilitli Eylemler Mekanizması:**
  - Veritabanı ve TypeScript modellerine `archived: boolean` alanı eklendi (`ALTER TABLE notes ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT false;`).
  - Not kartlarının üç nokta (`...`) menüsüne ve not detay sayfasına **"Arşivle" / "Arşivden Çıkar"** seçeneği entegre edildi (`PATCH`/`POST`/`PUT /notes/:note_id/archive`).
  - Bir not arşivlendiğinde `Edit` (Düzenle), `Delete` (Sil) ve `Pin` (Sabitleme) eylemleri hem arayüzde kilitlenir hem de arka uçta (`PUT`/`DELETE`/`PATCH /pin` 403 Forbidden) korumaya alınır.
  - Arşivlenen notlar varsa panodan otomatik olarak çıkarılır (`pinned = false`), arayüzde silik ve gri tonlu (`opacity-60 grayscale-[40%] border-dashed bg-muted/30`) olarak ve "Arşivlendi" rozetiyle listelenir; arşivden çıkarıldığında tüm düzenleme, silme ve pinleme yetenekleri anında eski haline döner.
- **Yeni Zaman Bloğu (Time Slot) Not Bloğu ve Otomatik Süre Hesaplama:**
  - Markdown içerikleri için standart code fence (` ```timeslot `) formatında yeni bir zaman bloğu tasarlandı (`src/lib/timeslot.ts`).
  - **CSS RGBA Renk Formatı ve Etiket Çakışmasını Önleme:** Hex renk kodlarının (`#3b82f6`) sistem tarafından etiket (#tag) olarak algılanmasını önlemek için standart CSS `rgba(...)` renk formatına (`rgba(59, 130, 246, 1)`) geçildi; sunucu tarafındaki etiket/kişi ayıklama regex'i kod bloklarını filtreleyecek şekilde güçlendirildi.
  - **5 Temel Bilgi ve Süre Gösterimi:** Başlangıç zamanı, bitiş zamanı, işin adı/başlığı, detaylı açıklama ve blok rengi ile canlı hesaplanan süre rozeti (`⏱️ 1 sa 30 dk`) görsel kart üzerinde formatlanır (`TimeSlotCard.tsx`).
  - **Editör Entegrasyonu:** Editör araç çubuğuna ("Zaman Bloğu") butonu ve `/timeslot` slash komutu eklendi. Renk paleti seçimi ve canlı önizleme sunan `TimeSlotDialog.tsx` modalı entegre edildi.
- **3 İçerik Düzenleme Modunda Tam Odaklanma (Full Focus Mode):**
  - **1. Metin (Markdown):** `MarkdownEditor.tsx` üzerinde tam ekran, canlı kelime/karakter istatistiği, hızlı bloklar ve başlık düzenleme destekli Full Focus.
  - **2. Çizim & Şema (Canvas):** `DrawingEditor.tsx` üzerinde tam ekran tuval, ızgara kontrolü, zengin çizim araçları ve serbest SVG şema çizimi.
  - **3. Hiyerarşik Outline:** `OutlineEditor.tsx` üzerinde tam ekran madde ağacı, madde/alt madde yönetimi (`Tab`/`Shift+Tab`), sürükle-bırak ve durum döngüsü.
  - `NoteDetail.tsx` içerisinde Full Focus aktifken 3 mod arasında kesintisiz geçiş yapabilme, `Esc` ile odaktan çıkış ve `Ctrl+S` ile anında kaydetme sağlandı.
- **Sınırsız Not Versiyonlama & Geri Yükleme (Note Versioning):**
  - **Veritabanı Katmanı:** `note_versions` tablosu oluşturuldu (`version_id`, `note_id`, `user_id`, `version_number`, `title`, `content`, `date`, `tags`, `people`, `custom_fields`, `change_summary`, `created_at`).
  - **Otomatik Versiyon Kaydı:** Her not oluşturulduğunda otomatik olarak v1 versiyonu oluşturulur. Her düzenleme, alan güncellemesi, yorum ekleme/silme veya geri yükleme işleminde yeni bir versiyon numarası (`v2`, `v3`...) ile tüm geçmiş sınırsız olarak saklanır.
  - **Arayüz Entegrasyonu:** Not kartlarındaki 3 nokta (`...`) menüsüne ve not detay sayfasına **"Versiyon Geçmişi"** (`NoteVersionsDialog.tsx`) butonu eklendi.
  - **Karşılaştırma ve Geri Dönüş:** Geçmiş versiyonların listesi, kelime sayıları, değişiklik açıklamaları ve içerik önizlemeleri incelenebilir; **"vX Versiyonuna Geri Dön"** butonuyla not tek tıkla eski haline döndürülebilir.
- **Gömülü Markdown Not Yorumları (Embedded Note Comments):**
  - **Özel DB Alanı Olmadan Gömülü Yapı:** Veritabanında ayrı bir alan veya tablo açılmaksızın yorumlar doğrudan notun `content` (Markdown) alanı içinde özel bloklar olarak saklanır (`src/lib/comments.ts`).
  - **Arama & Tarih Filtreleme Uyumluluğu:** Yorumlar not içeriğinde yer aldığı için hem backend tarafında (`q` parametresi ile `ILIKE %kelime%`) hem de frontend arama/filtreleme motorunda otomatik olarak taranır ve arama sonuçlarına dahil edilir.
  - **Desteklenen Markdown Formatları:** Minimalist tasarımda `[bağlantı metni](url)` linkleri, `**kalın**`, `*italik*` ve çok satırlı paragraflar desteklenir.
  - **Yorum CRUD Yetenekleri:** Yorum ekleme, yerinde (inline) düzenleme ve silme fonksiyonları eklendi (`NoteCommentsSection.tsx`). Her yorum işlemi notun yeni bir versiyon kaydını otomatik olarak üretir.

---

### 📅 22 Ağustos 2026

- **Genel Dosya ve Belge Yükleme Desteği (PDF, TXT, MP4, MP3, DOCX, ZIP vb.):**
  - **Evrensel Yükleme Modalı:** Markdown editör araç çubuğuna ve `/` menüsüne `FileUploadDialog.tsx` bileşeni entegre edildi. Sürükle-bırak desteği ve dosya uzantısına göre dinamik ikon gösterimi sağlandı.
  - **Format İkonlu Markdown Bağlantıları:** Yüklenen dosyalar metin içerisine formatlarına uygun ikonlarla `[📄 dokuman.pdf](/api/files/:file_id)` veya `[🎬 video.mp4](/api/files/:file_id)` olarak eklenir.
  - **Yeni Sekmede Açılma & Güvenli İndirme:** Markdown içerisindeki bağlantılara tıklandığında `target="_blank" rel="noreferrer"` ile içeriğin yeni sekmede açılması sağlandı.
  - **Backend Çoklu MIME & Inline Dağıtım:** Sunucu tarafındaki `/upload` ve `/files/:file_id` endpoint'leri video, ses, doküman ve arşiv formatlarını destekleyecek dinamik `Content-Type` ve `Content-Disposition: inline` başlıklarıyla güçlendirildi (`5a2306e`).

- **Not Şifreleme ve Parola Koruması (Note Encryption):**
  - **Web Crypto API & Kriptografi Katmanı:** İstemci tarafında çalışan `src/lib/crypto.ts` modülü ile SHA-256 + 16-byte rastgele salt parola hashleme ve doğrulama motoru geliştirildi.
  - **Veritabanı & DDL Migrasyonu:** `notes` ve `note_versions` tablolarına `is_encrypted: boolean (default: false)` ve `password_hash: text` sütunları eklendi.
  - **3 Nokta & Detay Menü Eylemleri:** Not kartları ve detay sayfasında şifresiz notlar için **"Notu Şifrele"**, şifreli notlar için **"Şifreyi Yönet / Kaldır"** modalları (`EncryptNoteDialog.tsx`) bağlandı.
  - **Kilit Ekranı Koruması:** Şifrelenmiş notlarda parola girilip **"Kilidi Aç"** denilmedikçe ham metin, çizim, etiket ve gömülü yorumlar gizlenerek şık kilit ekranı gösterilir; istenildiğinde tek tıkla **"Yeniden Kilitle"** butonu sunulur.
  - **Kesintisiz Arama ve Takvim İndeksleme:** Şifrelenmiş notlar backend aramasında (`GET /notes?q=...`) ve takvim / tarih filtrelerinde listelenmeye devam eder (`5a2306e`).

- **Yorum Önizleme & Takvim Rozet Sayımları İyileştirmesi:**
  - `MarkdownView.tsx` içerisinde ham yorum blokları (`<!-- inkwell:comments:... -->`) tamamen gizlenerek sadeleştirildi.
  - `server.ts` içerisindeki `extractNoteDates` fonksiyonu ile yorum tarihleri de ayıklanarak dashboard takvim rozet sayımlarına ve gün filtrelerine dahil edildi (`2ad8f40`).

- **Yorum Ekleme Alanının İsteğe Bağlı Açılması (On-Demand Toggle):**
  - `NoteCommentsSection.tsx` içerisinde yeni yorum formu varsayılan olarak gizlendi.
  - Başlık çubuğundaki **"Yorum Ekle"** butonuyla açılan form, **"İptal"** veya başarılı gönderim sonrasında otomatik olarak kapanacak şekilde optimize edildi (`0ceeba4`).

- **İlişkili Notlar Yönlendirme ve Bağlantı Düzeltmesi:**
  - `NoteDetail.tsx` altındaki ilişkili not referans bağlantıları `/note/${rNote.slug || rNote.note_id}` formatına getirilerek kırık yönlendirme hatası giderildi (`0ceeba4`).

---

### 📅 28 Ağustos 2026

- **Notu Kes (Split Note) ve Notu Birleştir (Merge Note) Blok Yapısı:**
  - **Notu Kes Bloğu:** Editör araç çubuğuna ve `/split` slash menüsüne "Notu Kes" butonu eklendi. `<!-- inkwell:split-note -->` bloğu yerleştirilerek onaylandığında not ayrım yerinden iki bağımsız nota bölünür; ikinci bölüm yeni bir not olarak oluşturulur (`SplitNoteDialog.tsx`).
  - **Notu Birleştir Bloğu:** Editör araç çubuğuna ve `/merge` slash menüsüne "Notu Birleştir" butonu eklendi. Modal üzerinde aranabilir mevcut not listesi veya `[[Not Adı]]` wikilink referansları sunulur.
  - **Zengin Metadata Aktarımı:** Birleştirilen notun içeriğinin yanı sıra konumu, etiketleri, kişileri, oluşturulma tarihi ve dinamik alanları Markdown alıntı bloğuna formatlı olarak eklenir ve ardından birleştirilen not veritabanından güvenli bir şekilde silinir.

- **Global Not Filtreleme ve Pinleme Hatalarının Giderilmesi:**
  - **Tüm Notları Kapsayan Filtreleme:** Dashboard üzerindeki "Not Filtresi" (Tamamlanmamış görevler, tamamlanmış görevler, çizim içeren notlar, bağlantılı notlar vb.) yalnızca bugünün notlarına değil, sistemdeki tüm notlara uygulanacak şekilde revize edildi.
  - **Sabitlenmiş (Pinned) Not Kartı Yönlendirmesi:** Pin'lenen not kartlarına tıklandığında doğru `/note/:slug` veya `/note/:note_id` rotasına sorunsuz geçişi sağlandı.

---

### 📅 8 Eylül 2026 (Sola Sabit Menubar & 4. İçerik Modu Zihin Haritası)

- **Sola Sabit Modern Menubar Mimarisi (`AppMenubar.tsx`):**
  - Üst gezinme çubuğu (header/navbar) kaldırılarak sol tarafta `w-64 fixed left-0 top-0 bottom-0` sabit dikey menubar kurgulandı.
  - **Prominent "+ Yeni Not Ekle" Butonu:** Menü üzerinde dikkat çekici renk geçişine sahip doğrudan hızlı not oluşturma eylemi konumlandırıldı.
  - Navigasyon bağlantıları: *Bugün* (`/`), *Tüm Notlar* (`/notes`), *Ağ Grafiği* (`/graph`), *Harita* (`/map`), *Kanban* (`/kanban`), *Bildirimler* ve *Ayarlar*.
  - Alt kısıma tema seçici ve kullanıcı profili/çıkış menüsü entegre edildi.
  - Mobil cihazlarda kompakt üst çubuk ve akıcı slide-out drawer (Sheet) ile kusursuz responsive deneyim sağlandı.
  - `Dashboard.tsx`, `AllNotes.tsx`, `GraphView.tsx`, `MapView.tsx`, `KanbanPage.tsx`, `NoteDetail.tsx` ve `SettingsPage.tsx` sayfaları `lg:pl-64` düzenine uyarlandı (`2508dce`).

- **Temiz Yeni Not Ekleme Sayfası (`NewNotePage.tsx`):**
  - `/new` ve `/notes/new` rotalarında çalışan, temiz ve dikkat dağıtmayan tam ekran not oluşturma sayfası geliştirildi.
  - 4 içerik modu, başlık, tarih, konum, özel alanlar, şifreleme ve tam odak modu entegrasyonu sağlandı.

- **Dördüncü İçerik Düzenleme Modu: Zihin Haritası (Mindmap Engine):**
  - **`src/lib/mindmapParser.ts`:** Markdown hiyerarşisi (`#`, `##`, `-`) ve `MindmapNode` ağacı arasında kayıpsız iki yönlü ayrıştırıcı ve serileştirici geliştirildi. Renk kodları (`[blue]`, `[emerald]`, `[amber]` vb.) doğrudan markdown etiketleri olarak tutulur.
  - **`src/components/mindmap/MindmapEditor.tsx`:**
    - Dinamik Bézier bağlantılı etkileşimli SVG ağacı.
    - Alt ve kardeş dal ekleme/çıkarma, dal katlama/açma, satır içi metin düzenleme (inline editing).
    - Canlı renk paleti seçimi, tuval Pan & Zoom kontrolleri, merkeze hizalama ve SVG olarak dışa aktarma.
    - Canlı Markdown taslak sekmesi ile anlık metin düzenleme senkronizasyonu.
  - **`src/components/mindmap/MindmapViewer.tsx`:**
    - Not kartlarında (`NoteCard.tsx`), not detayında (`NoteDetail.tsx`) ve Markdown kod bloklarında (`MarkdownView.tsx`) zihin haritalarını canlı ve estetik olarak render eden görüntüleyici motoru.

---

### 📅 9 Eylül 2026 (Kesintisiz CTRL+S & Sürükle-Bırak Etiket/Konum/Kişi Entegrasyonu)

- **Sol Kenar Çubuğundan Notlara Sürükle-Bırak (Drag & Drop) Entegrasyonu:**
  - **Kenar Çubuğu Veri Aktarımı (`Sidebar.tsx`):** Sol kenar çubuğundaki etiketler (`#etiket`), kişiler (`@kişi`) ve konumlar (`📍 konum`) draggable hale getirilerek hem zengin JSON veri modeli (`application/json`) hem de doğrudan metin editörlerine bırakılabilen düz metin formatı (`text/plain`) ile donatıldı.
  - **Not Kartlarına Bırakma (`NoteCard.tsx`):**
    - Dashboard ve Tüm Notlar sayfalarındaki not kartlarının üzerine sürüklenen etiket, kişi veya konum bırakıldığında, görsel vurgu (ring & shadow) eşliğinde notun meta verileri (`tags`, `people`, `location_id`) ve içeriği otomatik güncellenir.
    - Arka uç `PUT /notes/:id` API isteği ile anında kaydedilir ve bildirim bildirimi (toast) görüntülenir.
  - **Not Detay Sayfası (`NoteDetail.tsx`):**
    - Düzenleme (Edit) modunda içeriğe ve metadata durumuna anlık ekleme yapılır.
    - Görüntüleme (View) modunda doğrudan API üzerinden not güncellenerek sayfa içeriği yenilenir.
  - **Yeni Not Ekle Sayfası (`NewNotePage.tsx`) & Hızlı Not Oluşturucu (`NoteComposer.tsx`):**
    - Sürüklenen etiketler veya kişiler taslak içeriğe otomatik eklenir; sürüklenen konumlar hem seçili konum olarak atanır hem de içerik gövdesine işlenir.

- **Tüm İçerik Modlarında Kesintisiz CTRL+S Desteği:**
  - **Düzenleme / Güncelleme Modu (`NoteDetail.tsx`):** Kullanıcı Markdown, Çizim, Outline veya Zihin Haritası (Mindmap) modlarından hangisinde olursa olsun, klavyeden `Ctrl+S` (veya Mac için `Cmd+S`) tuşladığında düzenleme oturumundan (`editing: true`) çıkılmaksızın tüm değişiklikler doğrudan veritabanına ve versiyon geçmişine kaydedilir.
  - **Yeni Not Ekleme Modu (`NewNotePage.tsx`):** Yeni not oluşturulurken ilk `Ctrl+S` ile not sisteme kaydedilir ve sayfa/odak bozulmadan sonraki `Ctrl+S` eylemleri mevcut notu güncellemeye devam eder; kullanıcının yazma akışı ve içerik modu kesintiye uğramaz.
  - **Editörler Arası Yakalama (`MarkdownEditor.tsx` & `NoteComposer.tsx`):** Metin alanı, başlık veya tuval odaklıyken tarayıcının varsayılan "Sayfayı Kaydet" diyaloğu engellenerek arka uç kayıt fonksiyonu tetiklenir.

---

### 📅 10 Eylül 2026 (React Hook Sırası Güvenliği & Stabilite İyileştirmesi)

- **React Error #310 (Hook Çağrı Sırası İhlali) Giderilmesi:**
  - `NoteDetail.tsx` içerisinde sayfa yükleme anında tetiklenen erken dönüş (`if (!note) return (...)`) koşulunun altında kalan durum hook'u (`isDragOver`) bileşenin en üst seviyesine taşındı.
  - Sürükle-bırak olay işleyicileri (`handleDragOver`, `handleDragLeave`, `handleDrop`) erken dönüşlerden önce tanımlanarak bileşenin yaşam döngüsü boyunca çağrılan Hook sayısının ve sırasının her render'da birebir tutarlı olması sağlandı.
  - Yükleme esnasında kullanıcıya akıcı bir yükleniyor göstergesi sunuldu (`deaa6ae`).

---

## 6. Dağıtım ve DevOps Yapılandırması

Inkwell V2, Docker konteyner mimarisi ile Coolify veya herhangi bir Docker Host üzerinde sıfır kesintiyle çalışacak şekilde yapılandırılmıştır.

```dockerfile
# Multi-Stage Production Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/data
COPY package*.json ./
RUN npm ci --only=production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.ts ./
COPY --from=builder /app/src/db ./src/db
EXPOSE 3000
CMD ["npm", "start"]
```

### Ortam Değişkenleri (Environment Variables)
- `PORT`: Sunucu çalışma portu (Varsayılan: `3000`).
- `DATA_DIR`: Kalıcı dosya ve PGlite veritabanı depolama dizini (Varsayılan: `/data`).
- `DATABASE_URL`: Harici PostgreSQL bağlantı adresi (`postgresql://user:pass@host:5432/db`).
- `JWT_SECRET`: Güvenli oturum token imzalama anahtarı.
- `GOOGLE_MAPS_PLATFORM_KEY`: (Opsiyonel) Google Maps JavaScript API anahtarı.
- `GEMINI_API_KEY`: (Opsiyonel) Google Gemini Yapay Zeka anlamsal arama ve özetleme anahtarı.

---

*Belge son güncelleme tarihi: 10 Eylül 2026*
