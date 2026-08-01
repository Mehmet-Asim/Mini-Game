/* ==========================================================================
   Senaryo — TÜM METİNLER BURADA

   Sahne dosyalarına dokunmadan metinleri değiştirebilirsin. Zamanlamalar
   sahnede, kelimeler burada.

   Yer tutucular:
     {hero}     → teklifi hazırlayan kişinin adı
     {target}   → karşı tarafın adı
     {question} → kurulum ekranında yazılan soru
   ========================================================================== */

export const SCRIPT = {

  /* ---------- AÇILIŞ ---------- */
  intro: {
    c1: 'Her büyük görev, masaya serilen bir haritayla başlar.',
    c2: 'Fakat bazı rotaların yönü haritalarda değil, sadece tek bir kişide bulunur.',
    c3: 'Canavarlar yenilebilir, kaleler aşılabilir...\nFakat hiçbir kahraman tek başına efsane olamaz.',
    c4: '{target}',
    c5: 'Bunca yolu ve zorluğu tek başıma aştım. Ama bundan sonrasını yalnız yürümek istemiyorum.',
    c6: 'Eğer hazırsan... Geriye kalan tüm rotaları birlikte çizelim.'
  },

  /* ---------- FİNAL: SORU ---------- */
  ask: {
    c1: 'Ejderha düştü. Büyük kapılar açıldı. Verilen görev başarıyla tamamlandı.',
    c2: 'Ama bazı efsanevi görevlerin asıl finali...\nKılıçla ya da zaferle bitmez.',
    c3: '{hero}, bu yol boyunca aslında tek bir sorunun cevabını arıyordu:\nCesaret bazen ejderhayla savaşmak değil, sadece o tek cümleyi söyleyebilmektir.',
    question: '{question}',
    optYes: 'Bu yolda seninle yürüyorum.',
    optNo: 'Şimdilik kamp ateşinde soluklanıp bekleyelim.',
    hintYes: 'Elini tut',
    hintNo: 'Mevcut pozisyonu koru'
  },

  /* ---------- FİNAL: KABUL ---------- */
  yes: {
    c1: 'Bazen bir maceradaki en büyük ödül...\nSandığın içindeki altınlar ya da hazineler değildir.',
    c2: 'Tüm tehlikelere rağmen senin yanında yürümeyi seçen kişidedir.',
    c3: '{hero} ❤️ {target}',
    c4: '🏆 Yeni Bölüm Açıldı:\nİkimizin Hikâyesi'
  },

  /* ---------- FİNAL: RET ---------- */
  no: {
    c1: 'Hmm... Devrilen ejderha birden gözlerini açtı.',
    c2: 'Bu beklenmedik cevabı sanırım o bile öngörememişti.',
    c3: 'Ama en efsanevi hikâyeler bazen ilk denemede tek atışta bitmez.',
    c4: '[ İLERLEME KAYDEDİLMEDİ ]',
    retry: '🔄 Son Kontrol Noktasına Dön'
  }
};

/** Sahne dosyalarının kısayolu */
export const S = SCRIPT;
