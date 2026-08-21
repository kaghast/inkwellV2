# 🖋️ Inkwell V2 — Kapsamlı Proje Dokümantasyonu

Bu belge, **Inkwell V2** projesinin başlangıcından bugüne kadar gerçekleştirilen tüm geliştirme adımlarını, sistemin teknolojik altyapısını, veritabanı mimarisini ve veri modellerini ayrıntılı olarak içermektedir.

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

**Inkwell V2**, modern bilgi yönetimi, düşünce haritalama, görsel çizim, hiyerarşik taslak çıkarma ve lokasyon bazlı not tutma ihtiyaçlarını tek bir çatıda birleştiren **Next-Generation Personal Knowledge Management (PKM)** platformudur.

### Temel Yetenekler:
- **3'ü 1 Arada Not Motoru:** Zengin Markdown metin, Excalidraw benzeri serbest vektörel çizim tuvali ve sürükle-bırak hiyerarşik taslak (Outline) üreticisi.
- **İki Yönlü Bağlantılar & Bilgi Ağı:** `[[Not Adı]]` sözdizimi ile notlar arası çift yönlü wikilink bağlantıları, referans listeleri ve 2D/3D Etkileşimli Ağ Grafiği (Graph View).
- **Kanban & Görev Yönetimi:** Not tipleriyle entegre, dinamik kolonlu görsel iş akış panosu.
- **Akıllı Harita & Canlı Konum:** Çift motorlu harita (Google Maps + Leaflet / OpenStreetMap), GPS otomatik konum tespiti ve Nominatim destekli küresel canlı arama.
- **Gelişmiş Organizasyon:** Çoklu sekmede (Etiketler, Kişiler, Konumlar) sürükle-bırak destekli hiyerarşik klasör/grup yönetimi.
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
- **Bileşen Kütüphanesi:** Radix UI Primitives (Dialog, Dropdown, Tabs, Popover, Progress, Checkbox vb.).
- **İkonografi:** Lucide React.
- **Yönlendirme & Durum:** React Router v6, React Context API (`FilterContext`, `AuthContext`), SWR & React Hook Form.
- **Markdown İşleme:** `react-markdown`, `remark-gfm` (Tablolar, checklist'ler, otomatik URL algılama ve kelime kaydırma koruması).
- **Harita Motoru:** `@vis.gl/react-google-maps`, Leaflet, React-Leaflet, CartoDB Voyager ve OSM Nominatim Geocoder.
- **Grafik & Görselleştirme:** Recharts, Force-directed 2D Canvas Graph Engine.

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

#### `notes` (Notlar ve Çizim/Outline İçerikleri)
| Alan Adı | Tip | Açıklama |
| :--- | :--- | :--- |
| `note_id` | `text` (PK) | Benzersiz not kimliği |
| `user_id` | `text` (FK -> users) | Notun sahibi |
| `slug` | `text` (Index) | SEO ve doğrudan erişim bağlantı adı |
| `title` | `text` | Not başlığı |
| `content` | `text` | Markdown metin / Vektör Çizim / Outline verisi |
| `date` | `text` (Index) | ISO Tarih damgası |
| `tags` | `jsonb` (`string[]`) | Not etiketleri dizisi |
| `people` | `jsonb` (`string[]`) | Bahsedilen kişiler (`@isim`) |
| `location_id` | `text` (FK -> locations) | Bağlı coğrafi konum |
| `note_type_id` | `text` (FK -> note_types) | Not tipi (Düz Not, Toplantı, Kart vb.) |
| `custom_fields` | `jsonb` | Dinamik not tipi alan değerleri |
| `pinned` | `boolean` | Sabitlenmiş not durumu |
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

#### `tags` & `people` (Etiketler ve Kişiler)
- `tags`: `tag_id`, `user_id`, `name`, `group_id`, `created_at`
- `people`: `person_id`, `user_id`, `name`, `group_id`, `created_at`

#### `kanban_columns` & `reminders` & `files`
- `kanban_columns`: `column_id`, `user_id`, `name`, `color`, `order_index`.
- `reminders`: `reminder_id`, `user_id`, `note_id`, `at`, `text`, `fired`, `fired_at`.
- `files`: `file_id`, `user_id`, `original_filename`, `content_type`, `size`, `data_base64`, `is_deleted`.

---

## 4. Özel Motorlar ve Bileşen Mimarisi

### 4.1. 3'ü 1 Arada Not Formatı Serileştirme Standardı
Tüm not tipleri saf Markdown uyumlu olarak tek bir `content` sütununda saklanır:
1. **Zengin Markdown:** Standart GFM markdown metinleri, başlıklar, listeler ve `[[wikilink]]` referansları.
2. **Vektörel Çizim Tuvali (Drawing):** 
   ````markdown
   ```drawing
   {
     "version": 1,
     "elements": [
       { "id": "1", "type": "rectangle", "x": 100, "y": 80, "width": 120, "height": 60, "strokeColor": "#3b82f6" }
     ],
     "gridMode": "dots"
   }
   ```
   ````
3. **Hiyerarşik Taslak (Outline Generator):**
   ```markdown
   - [ ] 1. Proje Analizi ve Gereksinimler
     - [x] 1.1 Veritabanı Şemasının Hazırlanması
     - [-] 1.2 Arayüz Mockup Tasarımları
   - [•] 2. Uygulama Geliştirme Aşaması
   ```

### 4.2. Canlı Geocoding ve Çift Motorlu Harita
- **Leaflet Fallback & ResizeObserver:** Harita kapsayıcısının boyut değişimlerini dinleyen `ResizeObserver` ve 3 kademeli `map.invalidateSize()` çağrısı ile gri/boş harita render hataları engellenmiştir.
- **Global OSM Arama:** Arama kutusuna yazıldığı anda yerel kayıtlı yerler ile OpenStreetMap Nominatim Geocoder sonuçları anında birleştirilerek `z-[2000]` katmanında listelenir.

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
  - **5 Temel Bilgi ve Süre Gösterimi:** Başlangıç zamanı, bitiş zamanı, işin adı/başlığı, detaylı açıklama ve blok rengi ile canlı hesaplanan süre rozeti (`⏱️ 1 sa 30 dk`) görsel kart üzerinde formatlanır (`TimeSlotCard.tsx`).
  - **Editör Entegrasyonu:** Editör araç çubuğuna ("Zaman Bloğu") butonu ve `/timeslot` slash komutu eklendi. Renk paleti seçimi ve canlı önizleme sunan `TimeSlotDialog.tsx` modalı entegre edildi.

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

*Belge son güncelleme tarihi: 21 Ağustos 2026*
