# Brookhaven RP Manager

Brookhaven Roblox roleplay etkinliklerini Discord üzerinden yönetmek için Discord.js v14 botu.

## Özellikler
- RP katılım paneli: Katılıyorum / Ayrılıyorum / Yedek listesi
- Kapasite sınırı, katılımcı ve yedek listesi
- RP geri sayımı, canlı durum ve süre raporu
- Kayıt açma/kapatma, RP kadrosu ve bitirme
- Uyarı, timeout, kick, ban ve isteğe bağlı mod-log kanalı
- Discord kanal erişimini kapat/aç komutları
- Etkinlik ve uyarı verilerini `data.json` içinde saklama

## Kurulum
1. Bilgisayara Node.js 18.17 veya daha yenisini yükle.
2. Discord Developer Portal'da yeni bir Application oluştur, Bot ekle ve token al.
3. Botun OAuth2 URL Generator bölümünde `bot` ve `applications.commands` kapsamlarını seç.
4. İzin olarak en az `View Channels`, `Send Messages`, `Embed Links`, `Read Message History`, `Moderate Members`, `Kick Members`, `Ban Members`, `Manage Channels` seç. İhtiyaç olmayan izinleri verme.
5. Bu klasörde `.env.example` dosyasını `.env` olarak kopyala ve `DISCORD_TOKEN`, `CLIENT_ID`, `GUILD_ID` alanlarını doldur. İsteğe bağlı log/rol alanları var.
6. Terminalde bu klasörde çalıştır:
   ```bash
   npm install
   npm run deploy
   npm start
   ```
7. Botu test sunucunda dene. Botun rolünü, işlem yapacağı üyelerin rollerinden yukarı taşı.

## Komutlar
- `/rp-kur baslik tarih kapasite aciklama`
- `/rp-baslat` — 5 dakika sonra canlıya geçer
- `/rp-sayac`
- `/rp-kadro`
- `/rp-kayit-kapat` / `/rp-kayit-ac`
- `/rp-bitir`
- `/uyar uye sebep`
- `/timeout uye dakika sebep`
- `/kick uye sebep`
- `/ban uye sebep`
- `/oda-kapat` / `/oda-ac`

## Önemli notlar
- Bot yalnızca Discord sunucusunu ve Discord kanal izinlerini yönetir. Roblox/Brookhaven içindeki oyun odasını, Roblox sunucusunu, oyuncu teleportunu veya oyun içi erişimi doğrudan kontrol etmez.
- `oda-kapat` komutu mevcut kanalın `@everyone` görünürlük ve mesaj gönderme izinlerini değiştirir. Kullanımdan önce test kanalında dene.
- Discord bot tokenını kimseyle paylaşma ve `.env` dosyasını GitHub'a yükleme.
- Bu sürüm başlangıç sürümüdür. Sürekli çalışan bir bilgisayar/VPS gerekir; telefon uygulamasını kapatmak botu çalıştırmaya yetmez.
- Veriler yerel `data.json` dosyasında tutulur; yedek al. Çok sunuculu/yoğun kullanım için SQLite/PostgreSQL ve daha kapsamlı hata yönetimi önerilir.
