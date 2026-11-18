# Inkwell — Markdown Destekli Not & Günlük Uygulaması

Düşüncelerinizi mürekkep gibi kâğıda dökün. Markdown destekli, `#etiket` / `@kişi` otomatik tamamlama, konum bilgisi (Leaflet harita), hatırlatıcılar, takvim ve Google OAuth 2.0 kimlik doğrulama ile tam özellikli modern not alma uygulaması.

---

## 🛠️ Teknik Yığın

- **Full-Stack Runtime**: Node.js 20+ / TypeScript / Express
- **Frontend**: React 18 / Vite / Tailwind CSS / Lucide Icons / Leaflet
- **Authentication**: JWT (HttpOnly Cookies) + Google OAuth 2.0 (Google Sign-In)
- **Paket Yöneticisi & Build**: npm / Vite / Docker

---

## 🚀 Coolify ile GitHub Public Repository Üzerinden Deploy Rehberi

Inkwell, Coolify üzerinde tek bir Docker konteyneri olarak **zero-config** (sıfır yapılandırma) ile çalışacak şekilde optimize edilmiştir.

### 1. Adım: Coolify'da Proje ve Uygulama Oluşturma
1. Coolify kontrol panelinize giriş yapın.
2. **Projects** > **New Project** (veya mevcut projeniz) seçeneğine gidin.
3. **+ New Resource** butonuna tıklayın ve **Public Repository** seçeneğini seçin.
4. GitHub public repository adresinizi girin (Örn: `https://github.com/kullanici-adiniz/inkwell`).
5. **Branch** olarak `main` (veya ilgili branch'inizi) belirleyin ve **Check repository** butonuna basın.

### 2. Adım: Build Pack Seçimi
- **Build Pack**: `Dockerfile` (otomatik olarak projedeki multi-stage `Dockerfile` algılanacaktır) veya `Docker Compose`.
- **Port**: `3000` (Coolify otomatik yönlendirme yapacaktır).

### 3. Adım: Ortam Değişkenleri (Environment Variables)
Coolify panelindeki **Environment Variables** bölümüne aşağıdaki değişkenleri ekleyin:

```env
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
JWT_SECRET=your_secure_jwt_secret_here
ADMIN_EMAIL=admin@inkwell.app
ADMIN_PASSWORD=change_me_to_a_strong_password
GOOGLE_CLIENT_ID=your_google_client_id_here.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_google_client_secret_here
VITE_GOOGLE_CLIENT_ID=your_google_client_id_here.apps.googleusercontent.com
# Opsiyonel: API'ye çerezli istek atabilecek ek origin'ler (virgülle ayrılmış)
CORS_ORIGINS=
# Opsiyonel: frontend farklı bir sitede barınıyorsa "none" yapın (varsayılan: lax)
COOKIE_SAMESITE=lax
# Opsiyonel: Google Takvim yenileme belirteçlerini şifreleyen anahtar (varsayılan: JWT_SECRET'tan türetilir)
INTEGRATION_ENCRYPTION_KEY=
```

> **Güvenlik notları:** `JWT_SECRET` boş bırakılırsa rastgele bir anahtar üretilip veri dizinine (`.data/.jwt_secret`) kaydedilir. Production'da `ADMIN_PASSWORD` verilmezse tek seferlik rastgele bir yönetici şifresi üretilir ve sunucu loglarına yazılır. `admin12345` varsayılanı yalnızca geliştirme ortamında kullanılır.

### 4. Adım: Google Cloud Console Yönlendirme Ayarları
Coolify size bir alan adı (örneğin `https://inkwell.sizin-sunucunuz.com`) tanımladığında, Google Cloud Console > Credentials sayfasında ilgili OAuth Client ID'nize şu callback URL'ini ekleyin:
- `https://inkwell.sizin-sunucunuz.com/api/auth/google/callback`

**Google Takvim (Ayarlar > Google Takvim):** Takvim bağlantısı da aynı callback URL'ini kullanır, ek bir yönlendirme adresi gerekmez. Google Cloud projesinde **Google Calendar API**'yi etkinleştirin ve OAuth izin ekranına `.../auth/calendar.events.readonly` kapsamını ekleyin. Kullanıcı bir kez izin verdikten sonra yenileme belirteci sunucuda şifreli saklanır; tekrar giriş gerekmez. `JWT_SECRET` (veya `INTEGRATION_ENCRYPTION_KEY`) değişirse kayıtlı bağlantılar çözülemez ve kullanıcılardan yeniden bağlanmaları istenir. OAuth izin ekranı "Testing" durumundaysa Google yenileme belirteçlerini 7 gün sonra geçersiz kılar; kalıcı bağlantı için uygulamayı "In production" durumuna alın.

### 5. Adım: Deploy!
- **Deploy** butonuna tıklayın. Coolify imajı derleyecek, `dist` varlıklarını oluşturacak ve port 3000 üzerinden uygulamanızı canlıya alacaktır.

---

## 📱 Uygulama Olarak Yükleme (PWA)

Inkwell bir Progressive Web App'tir. HTTPS üzerinden açıldığında (ya da `localhost`'ta) tarayıcı onu uygulama olarak yüklemeyi önerir:
- **Chrome / Edge (masaüstü ve Android):** Adres çubuğundaki yükle simgesi, kullanıcı menüsündeki "Uygulamayı yükle" veya Ayarlar > Görünüm > "Uygulama olarak kullan".
- **iPhone / iPad (Safari):** Paylaş > Ana Ekrana Ekle.

Service worker (`public/sw.js`) yalnızca üretim derlemesinde kaydedilir. Sayfalar her zaman ağdan yüklenir (yeni sürüm hemen gelir), bağlantı yoksa çevrimdışı sayfası gösterilir. Derlenmiş JS/CSS dosyaları, simgeler ve fontlar önbelleğe alınır; **`/api` yanıtları ve yüklenen dosyalar hiçbir zaman önbelleğe alınmaz**, yani not içerikleri cihaz önbelleğinde kalmaz.

---

## 💻 Yerel Geliştirme (Local Development)

```bash
# Bağımlılıkları yükleyin
npm install

# .env dosyasını oluşturun
cp .env.example .env

# Geliştirme sunucusunu başlatın (Port 3000)
npm run dev

# Üretim için derleme
npm run build

# Üretim modunda başlatma
npm start
```

---

## 🐳 Docker ile Yerel Çalıştırma

```bash
# Docker imajını oluşturun ve başlatın
docker compose up -d --build

# http://localhost:3000 üzerinden erişebilirsiniz.
```
