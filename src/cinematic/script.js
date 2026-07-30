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
    c1: 'Bazı yollar, tek başına yürümek için fazla uzundur.',
    c2: 'Karanlık ormanların, eski surların ve ateşin ötesinde...',
    c3: '{hero} bir hazine değil, yolu paylaşacağı kişiyi arıyordu.',
    c4: '{target}',
    c5: 'Önümüzde bir ejderha var. Ama bu hikâyeyi tek başıma yazmak istemiyorum.',
    c6: 'Bu maceraya benimle gelir misin?'
  },

  /* ---------- FİNAL: SORU ---------- */
  ask: {
    c1: 'Ejderha sustu. Üç diyarın kapıları ardımızda kaldı.',
    c2: 'Fakat {hero}, yol boyunca taşıdığı asıl sırrı hâlâ söylemedi.',
    c3: 'Toplanan her kalp, bu tek cümleye giden yolu aydınlattı.',
    question: '{question}',
    optYes: 'Evet, bu maceraya seninle gelmek istiyorum.',
    optNo: 'Hayır, henüz buna hazır değilim.',
    hintYes: 'Elini tut',
    hintNo: 'Geri çekil'
  },

  /* ---------- FİNAL: KABUL ---------- */
  yes: {
    c1: 'Ve o anda, bütün yollar aynı ufukta buluştu.',
    c2: 'İki yolcu, yeni maceralarının ilk gün batımını birlikte izledi.',
    c3: '{target} & {hero}',
    c4: 'Bu hikâye burada bitmiyor. Tam burada, birlikte başlıyor.'
  },

  /* ---------- FİNAL: RET ---------- */
  no: {
    c1: 'Tam o sırada ejderha yeniden nefes aldı.',
    c2: 'Meğer yenilmemiş; yalnızca cevabı dinliyormuş.',
    c3: 'Görünüşe göre bu finali beğenmedi...',
    c4: 'Neyse ki kahramanların bir canı daha var.',
    retry: 'Hikâyeyi geri sar'
  }
};

/** Sahne dosyalarının kısayolu */
export const S = SCRIPT;
