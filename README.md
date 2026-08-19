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
ADMIN_PASSWORD=admin12345
GOOGLE_CLIENT_ID=your_google_client_id_here.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_google_client_secret_here
VITE_GOOGLE_CLIENT_ID=your_google_client_id_here.apps.googleusercontent.com
```

### 4. Adım: Google Cloud Console Yönlendirme Ayarları
Coolify size bir alan adı (örneğin `https://inkwell.sizin-sunucunuz.com`) tanımladığında, Google Cloud Console > Credentials sayfasında ilgili OAuth Client ID'nize şu callback URL'ini ekleyin:
- `https://inkwell.sizin-sunucunuz.com/api/auth/google/callback`

### 5. Adım: Deploy!
- **Deploy** butonuna tıklayın. Coolify imajı derleyecek, `dist` varlıklarını oluşturacak ve port 3000 üzerinden uygulamanızı canlıya alacaktır.

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
