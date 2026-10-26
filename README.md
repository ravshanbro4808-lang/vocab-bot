# Tillar lug'ati — ko'p tilli bot

Eski koreys botingiz bilan bir xil dizayn, lekin ko'p tilli.

## Ishga tushirish (yangi bot sifatida)
1. BotFather'da YANGI bot oching, tokenni oling.
2. GitHub'da yangi repo oching, shu 3 faylni (`server.js`, `index.html`, `package.json`) yuklang.
3. Railway'da yangi loyiha oching va eski botdagi o'zgaruvchilarni ko'chiring, faqat quyidagilarni yangilang:
   - `BOT_TOKEN` — yangi botniki
   - `BOT_USERNAME` — yangi botning username'i (@siz)
   - `WEBAPP_URL` — yangi Railway manzili
   - `DATA_DIR` — yangi Volume (eski bot bazasi bilan aralashtirmang)
   - `GEMINI_API_KEY` yoki `ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_ID`, `SECRET`, `ADMIN_IDS` / `ADMIN_EMAILS` — o'zingizniki.
4. Google Cloud'da yangi manzilni "Authorized JavaScript origins"ga qo'shing.

## Nimalar o'zgardi
- **Kitob yaratish** (Sozlamalar → 📚 Kitob yaratish): fayl yuklashdan oldin tillarni belgilaysiz. Faqat belgilangan tillardagi so'zlar ajratiladi, har bir til uchun ALOHIDA kitob yaratiladi (masalan «Kitob — Ingliz», «Kitob — Rus»).
- **Mavjud kitobga fayl qo'shish**: faqat shu kitobning tilidagi so'zlar olinadi.
- Har bir so'z o'z tilida o'qiladi (ovoz, talaffuz, tinglash o'yinlari). Bosh sahifada til bo'yicha filtr va bayroqlar bor.
- Koreys grammatika o'yinlari faqat koreys kitobi bo'lsa ko'rinadi.
- **Tulki Kori** hamma tillarda yordam beradi (mikrofon tili bayroq tugmasi bilan almashadi).
- Tillar: ingliz, koreys, rus, yapon, xitoy, arab, turk, nemis, fransuz, ispan, italyan, portugal, hind. Yangi til qo'shish: `server.js` ichidagi `LANGS` ro'yxatiga bitta qator qo'shing.

## Muhim eslatma
Bir xil yozuvdagi tillarni (ingliz, nemis, fransuz... — hammasi lotin) faqat AI ajrata oladi, shuning uchun `GEMINI_API_KEY` yoki `ANTHROPIC_API_KEY` bo'lishi kerak. AI kalitsiz faqat koreys, rus, yapon, xitoy, arab, hind kabi alohida yozuvli tillar to'g'ri ajratiladi; lotin tillarida chap tomon so'z, o'ng tomon tarjima deb olinadi.
