// UI texts of the bot-protection challenge badge shown next to a form's submit
// button: idle (before submitting), solving, done and error.
//
// Keys are the base language codes a Faable Auth tenant can enable (see the
// dashboard's components/apps/auth/user/locales.ts), plus the script/region
// variants whose text differs: 'zh-Hant' (also zh-TW / zh-HK), 'sr-Latn' (plain
// 'sr' is Cyrillic) and 'pt-BR' ('pt' is European Portuguese).
//
// Lookup falls back region → base → 'en'; that is done by the caller.
// Entries marked `// review` are best-effort and want a native speaker's check.

export type ChallengeTexts = {
  idle: string
  solving: string
  done: string
  error: string
}

export const CHALLENGE_TEXTS: Record<string, ChallengeTexts> = {
  en: {
    idle: 'Protected against bots',
    solving: 'Checking you are human…',
    done: 'Verified',
    error: 'Could not verify'
  },
  es: {
    idle: 'Protegido contra bots',
    solving: 'Comprobando que eres una persona…',
    done: 'Verificado',
    error: 'No se pudo verificar'
  },
  ca: {
    idle: 'Protegit contra bots',
    solving: 'Comprovant que ets una persona…',
    done: 'Verificat',
    error: "No s'ha pogut verificar"
  },
  eu: {
    // review
    idle: 'Boten aurka babestua',
    solving: 'Gizakia zarela egiaztatzen…',
    done: 'Egiaztatuta',
    error: 'Ezin izan da egiaztatu'
  },
  gl: {
    idle: 'Protexido contra bots',
    solving: 'Comprobando que es unha persoa…',
    done: 'Verificado',
    error: 'Non se puido verificar'
  },
  pt: {
    idle: 'Protegido contra bots',
    solving: 'A verificar que é humano…',
    done: 'Verificado',
    error: 'Não foi possível verificar'
  },
  'pt-BR': {
    idle: 'Protegido contra bots',
    solving: 'Verificando se você é humano…',
    done: 'Verificado',
    error: 'Não foi possível verificar'
  },
  fr: {
    idle: 'Protégé contre les bots',
    solving: 'Vérification que vous êtes humain…',
    done: 'Vérifié',
    error: 'Échec de la vérification'
  },
  de: {
    idle: 'Vor Bots geschützt',
    solving: 'Prüfung, ob Sie ein Mensch sind…',
    done: 'Verifiziert',
    error: 'Verifizierung fehlgeschlagen'
  },
  it: {
    idle: 'Protetto dai bot',
    solving: 'Verifica che tu sia umano…',
    done: 'Verificato',
    error: 'Verifica non riuscita'
  },
  nl: {
    idle: 'Beschermd tegen bots',
    solving: 'Controleren of je een mens bent…',
    done: 'Geverifieerd',
    error: 'Verificatie mislukt'
  },
  sv: {
    idle: 'Skyddad mot bottar',
    solving: 'Kontrollerar att du är en människa…',
    done: 'Verifierad',
    error: 'Kunde inte verifiera'
  },
  no: {
    idle: 'Beskyttet mot roboter',
    solving: 'Sjekker at du er et menneske…',
    done: 'Verifisert',
    error: 'Kunne ikke verifisere'
  },
  nb: {
    idle: 'Beskyttet mot roboter',
    solving: 'Sjekker at du er et menneske…',
    done: 'Verifisert',
    error: 'Kunne ikke verifisere'
  },
  nn: {
    // review
    idle: 'Verna mot robotar',
    solving: 'Sjekkar at du er eit menneske…',
    done: 'Verifisert',
    error: 'Kunne ikkje verifisere'
  },
  da: {
    idle: 'Beskyttet mod bots',
    solving: 'Kontrollerer, at du er et menneske…',
    done: 'Verificeret',
    error: 'Kunne ikke verificere'
  },
  fi: {
    idle: 'Suojattu boteilta',
    solving: 'Tarkistetaan, että olet ihminen…',
    done: 'Vahvistettu',
    error: 'Vahvistus epäonnistui'
  },
  is: {
    // review
    idle: 'Varið gegn vélmennum',
    solving: 'Athuga hvort þú sért manneskja…',
    done: 'Staðfest',
    error: 'Ekki tókst að staðfesta'
  },
  fo: {
    // review
    idle: 'Vardur móti bottum',
    solving: 'Kanni, um tú ert eitt menniskja…',
    done: 'Váttað',
    error: 'Kundi ikki vátta'
  },
  pl: {
    idle: 'Chronione przed botami',
    solving: 'Sprawdzanie, czy jesteś człowiekiem…',
    done: 'Zweryfikowano',
    error: 'Nie udało się zweryfikować'
  },
  cs: {
    idle: 'Chráněno proti botům',
    solving: 'Ověřujeme, že jste člověk…',
    done: 'Ověřeno',
    error: 'Ověření se nezdařilo'
  },
  sk: {
    idle: 'Chránené pred botmi',
    solving: 'Overujeme, či ste človek…',
    done: 'Overené',
    error: 'Overenie zlyhalo'
  },
  sl: {
    idle: 'Zaščiteno pred boti',
    solving: 'Preverjamo, ali ste človek…',
    done: 'Preverjeno',
    error: 'Preverjanje ni uspelo'
  },
  hr: {
    idle: 'Zaštićeno od botova',
    solving: 'Provjeravamo jeste li čovjek…',
    done: 'Potvrđeno',
    error: 'Provjera nije uspjela'
  },
  sr: {
    idle: 'Заштићено од ботова',
    solving: 'Проверавамо да ли сте човек…',
    done: 'Верификовано',
    error: 'Провера није успела'
  },
  'sr-Latn': {
    idle: 'Zaštićeno od botova',
    solving: 'Proveravamo da li ste čovek…',
    done: 'Verifikovano',
    error: 'Provera nije uspela'
  },
  bs: {
    idle: 'Zaštićeno od botova',
    solving: 'Provjeravamo jeste li čovjek…',
    done: 'Potvrđeno',
    error: 'Provjera nije uspjela'
  },
  mk: {
    // review
    idle: 'Заштитено од ботови',
    solving: 'Проверуваме дали сте човек…',
    done: 'Потврдено',
    error: 'Проверката не успеа'
  },
  bg: {
    idle: 'Защитено от ботове',
    solving: 'Проверяваме дали сте човек…',
    done: 'Потвърдено',
    error: 'Неуспешна проверка'
  },
  be: {
    // review
    idle: 'Абаронена ад ботаў',
    solving: 'Правяраем, што вы чалавек…',
    done: 'Пацверджана',
    error: 'Не ўдалося праверыць'
  },
  uk: {
    idle: 'Захищено від ботів',
    solving: 'Перевіряємо, що ви людина…',
    done: 'Підтверджено',
    error: 'Не вдалося перевірити'
  },
  ru: {
    idle: 'Защищено от ботов',
    solving: 'Проверяем, что вы человек…',
    done: 'Подтверждено',
    error: 'Не удалось проверить'
  },
  et: {
    idle: 'Kaitstud bottide eest',
    solving: 'Kontrollime, et olete inimene…',
    done: 'Kinnitatud',
    error: 'Kinnitamine ebaõnnestus'
  },
  lv: {
    // review
    idle: 'Aizsargāts pret robotiem',
    solving: 'Pārbaudām, vai esat cilvēks…',
    done: 'Pārbaudīts',
    error: 'Neizdevās pārbaudīt'
  },
  lt: {
    idle: 'Apsaugota nuo botų',
    solving: 'Tikriname, ar esate žmogus…',
    done: 'Patvirtinta',
    error: 'Nepavyko patvirtinti'
  },
  hu: {
    idle: 'Botok ellen védve',
    solving: 'Ellenőrizzük, hogy Ön ember-e…',
    done: 'Ellenőrizve',
    error: 'Az ellenőrzés sikertelen'
  },
  ro: {
    idle: 'Protejat împotriva boților',
    solving: 'Verificăm dacă ești om…',
    done: 'Verificat',
    error: 'Verificarea a eșuat'
  },
  mt: {
    // review
    idle: 'Protett kontra l-bots',
    solving: 'Qed nivverifikaw li inti bniedem…',
    done: 'Ivverifikat',
    error: 'Ma setax jiġi vverifikat'
  },
  el: {
    idle: 'Προστασία από bots',
    solving: 'Επαληθεύουμε ότι είστε άνθρωπος…',
    done: 'Επαληθεύτηκε',
    error: 'Η επαλήθευση απέτυχε'
  },
  sq: {
    // review
    idle: 'I mbrojtur nga botët',
    solving: 'Po verifikojmë që jeni njeri…',
    done: 'U verifikua',
    error: 'Verifikimi dështoi'
  },
  tr: {
    idle: 'Botlara karşı korumalı',
    solving: 'İnsan olduğunuz doğrulanıyor…',
    done: 'Doğrulandı',
    error: 'Doğrulanamadı'
  },
  az: {
    // review
    idle: 'Botlardan qorunur',
    solving: 'İnsan olduğunuz yoxlanılır…',
    done: 'Təsdiqləndi',
    error: 'Təsdiqlənmədi'
  },
  hy: {
    // review
    idle: 'Պաշտպանված է բոտերից',
    solving: 'Ստուգում ենք, որ մարդ եք…',
    done: 'Հաստատված է',
    error: 'Չհաջողվեց հաստատել'
  },
  ka: {
    // review
    idle: 'დაცულია ბოტებისგან',
    solving: 'ვამოწმებთ, რომ ადამიანი ხართ…',
    done: 'დადასტურებულია',
    error: 'ვერ დადასტურდა'
  },
  ga: {
    // review
    idle: 'Cosanta ar bhotanna',
    solving: 'Ag seiceáil gur duine thú…',
    done: 'Fíoraithe',
    error: 'Níorbh fhéidir fíorú'
  },
  gd: {
    // review
    idle: 'Dìonta bho bhotaichean',
    solving: "A' dearbhadh gur e duine a th' annad…",
    done: 'Air a dhearbhadh',
    error: "Cha b' urrainn dhuinn a dhearbhadh"
  },
  cy: {
    // review
    idle: "Wedi'i ddiogelu rhag bots",
    solving: 'Yn gwirio eich bod yn ddynol…',
    done: "Wedi'i wirio",
    error: 'Methu gwirio'
  },
  br: {
    // review
    idle: "Gwarezet a-enep d'ar robotoù",
    solving: "O wiriañ ez oc'h un den…",
    done: 'Gwiriet',
    error: "N'haller ket gwiriañ"
  },
  lb: {
    // review
    idle: 'Géint Bots geschützt',
    solving: 'Mir kontrolléieren, ob Dir e Mënsch sidd…',
    done: 'Verifizéiert',
    error: 'Verifikatioun feelgeschloen'
  },
  fy: {
    // review
    idle: 'Beskerme tsjin bots',
    solving: 'Kontrolearje oft jo in minske binne…',
    done: 'Ferifiearre',
    error: 'Ferifikaasje mislearre'
  },
  ar: {
    idle: 'محمي من الروبوتات',
    solving: 'جارٍ التحقق من أنك إنسان…',
    done: 'تم التحقق',
    error: 'تعذّر التحقق'
  },
  he: {
    idle: 'מוגן מפני בוטים',
    solving: 'מוודאים שאתם בני אדם…',
    done: 'אומת',
    error: 'האימות נכשל'
  },
  fa: {
    idle: 'محافظت‌شده در برابر ربات‌ها',
    solving: 'در حال بررسی انسان بودن شما…',
    done: 'تأیید شد',
    error: 'تأیید ناموفق بود'
  },
  ku: {
    // review
    idle: 'Li dijî botan parastî ye',
    solving: 'Em kontrol dikin ku tu mirov î…',
    done: 'Hate piştrastkirin',
    error: 'Nehate piştrastkirin'
  },
  ckb: {
    // review
    idle: 'پارێزراوە لە بۆتەکان',
    solving: 'پشکنین دەکەین کە مرۆڤیت…',
    done: 'پشتڕاستکرایەوە',
    error: 'پشتڕاست نەکرایەوە'
  },
  ps: {
    // review
    idle: 'د بوټونو پر وړاندې خوندي',
    solving: 'تایید کوو چې تاسو انسان یاست…',
    done: 'تایید شو',
    error: 'تایید نه شو'
  },
  ur: {
    idle: 'بوٹس سے محفوظ',
    solving: 'تصدیق ہو رہی ہے کہ آپ انسان ہیں…',
    done: 'تصدیق ہو گئی',
    error: 'تصدیق نہیں ہو سکی'
  },
  hi: {
    idle: 'बॉट्स से सुरक्षित',
    solving: 'पुष्टि की जा रही है कि आप इंसान हैं…',
    done: 'सत्यापित',
    error: 'सत्यापन नहीं हो सका'
  },
  bn: {
    idle: 'বট থেকে সুরক্ষিত',
    solving: 'আপনি মানুষ কিনা যাচাই করা হচ্ছে…',
    done: 'যাচাই করা হয়েছে',
    error: 'যাচাই করা যায়নি'
  },
  ta: {
    // review
    idle: 'பாட்களிடமிருந்து பாதுகாக்கப்பட்டது',
    solving: 'நீங்கள் மனிதர் என்பதைச் சரிபார்க்கிறோம்…',
    done: 'சரிபார்க்கப்பட்டது',
    error: 'சரிபார்க்க முடியவில்லை'
  },
  te: {
    // review
    idle: 'బాట్‌ల నుండి రక్షించబడింది',
    solving: 'మీరు మనిషి అని నిర్ధారిస్తున్నాం…',
    done: 'ధృవీకరించబడింది',
    error: 'ధృవీకరించడం సాధ్యం కాలేదు'
  },
  kn: {
    // review
    idle: 'ಬಾಟ್‌ಗಳಿಂದ ರಕ್ಷಿಸಲಾಗಿದೆ',
    solving: 'ನೀವು ಮನುಷ್ಯರೇ ಎಂದು ಪರಿಶೀಲಿಸಲಾಗುತ್ತಿದೆ…',
    done: 'ಪರಿಶೀಲಿಸಲಾಗಿದೆ',
    error: 'ಪರಿಶೀಲಿಸಲು ಸಾಧ್ಯವಾಗಲಿಲ್ಲ'
  },
  ml: {
    // review
    idle: 'ബോട്ടുകളിൽ നിന്ന് സംരക്ഷിതം',
    solving: 'നിങ്ങൾ മനുഷ്യനാണോ എന്ന് പരിശോധിക്കുന്നു…',
    done: 'സ്ഥിരീകരിച്ചു',
    error: 'സ്ഥിരീകരിക്കാനായില്ല'
  },
  mr: {
    // review
    idle: 'बॉट्सपासून संरक्षित',
    solving: 'तुम्ही माणूस आहात का ते तपासत आहोत…',
    done: 'सत्यापित',
    error: 'सत्यापित करता आले नाही'
  },
  gu: {
    // review
    idle: 'બોટ્સથી સુરક્ષિત',
    solving: 'તમે માણસ છો તેની ચકાસણી થઈ રહી છે…',
    done: 'ચકાસાયેલ',
    error: 'ચકાસણી થઈ શકી નહીં'
  },
  pa: {
    // review
    idle: 'ਬੋਟਾਂ ਤੋਂ ਸੁਰੱਖਿਅਤ',
    solving: 'ਜਾਂਚ ਕਰ ਰਹੇ ਹਾਂ ਕਿ ਤੁਸੀਂ ਇਨਸਾਨ ਹੋ…',
    done: 'ਪ੍ਰਮਾਣਿਤ',
    error: 'ਪ੍ਰਮਾਣਿਤ ਨਹੀਂ ਹੋ ਸਕਿਆ'
  },
  or: {
    // review
    idle: 'ବଟ୍‌ରୁ ସୁରକ୍ଷିତ',
    solving: 'ଆପଣ ମଣିଷ କି ନାହିଁ ଯାଞ୍ଚ କରାଯାଉଛି…',
    done: 'ଯାଞ୍ଚ ହୋଇଛି',
    error: 'ଯାଞ୍ଚ କରିହେଲା ନାହିଁ'
  },
  as: {
    // review
    idle: 'বটৰ পৰা সুৰক্ষিত',
    solving: 'আপুনি মানুহ নেকি পৰীক্ষা কৰা হৈছে…',
    done: 'সত্যাপিত',
    error: "সত্যাপন কৰিব পৰা নগ'ল"
  },
  sd: {
    // review
    idle: 'بوٽس کان محفوظ',
    solving: 'تصديق ٿي رهي آهي ته توهان انسان آهيو…',
    done: 'تصديق ٿي وئي',
    error: 'تصديق نه ٿي سگهي'
  },
  si: {
    // review
    idle: 'බොට්වලින් ආරක්ෂිතයි',
    solving: 'ඔබ මිනිසෙකු දැයි පරීක්ෂා කරමින්…',
    done: 'තහවුරු කළා',
    error: 'තහවුරු කළ නොහැකි විය'
  },
  ne: {
    // review
    idle: 'बटहरूबाट सुरक्षित',
    solving: 'तपाईं मानिस हो कि होइन जाँच गर्दै…',
    done: 'प्रमाणित',
    error: 'प्रमाणित गर्न सकिएन'
  },
  dv: {
    // review
    idle: 'ބޮޓުންގެ ކިބައިން ރައްކާތެރި',
    solving: 'ތިބާއަކީ އިންސާނެއްކަން ޔަޤީންކުރަނީ…',
    done: 'ޔަޤީންކުރެވިއްޖެ',
    error: 'ޔަޤީން ނުކުރެވުނު'
  },
  th: {
    idle: 'ป้องกันบอทแล้ว',
    solving: 'กำลังตรวจสอบว่าคุณเป็นมนุษย์…',
    done: 'ยืนยันแล้ว',
    error: 'ยืนยันไม่สำเร็จ'
  },
  lo: {
    // review
    idle: 'ປ້ອງກັນບອດ',
    solving: 'ກຳລັງກວດສອບວ່າທ່ານເປັນມະນຸດ…',
    done: 'ຢືນຢັນແລ້ວ',
    error: 'ບໍ່ສາມາດຢືນຢັນໄດ້'
  },
  km: {
    // review
    idle: 'ការពារពីបូត',
    solving: 'កំពុងពិនិត្យថាអ្នកជាមនុស្ស…',
    done: 'បានផ្ទៀងផ្ទាត់',
    error: 'មិនអាចផ្ទៀងផ្ទាត់បានទេ'
  },
  my: {
    // review
    idle: 'ဘော့များမှ ကာကွယ်ထားသည်',
    solving: 'သင်သည် လူဖြစ်ကြောင်း စစ်ဆေးနေသည်…',
    done: 'အတည်ပြုပြီး',
    error: 'အတည်မပြုနိုင်ပါ'
  },
  vi: {
    idle: 'Được bảo vệ khỏi bot',
    solving: 'Đang xác minh bạn là người…',
    done: 'Đã xác minh',
    error: 'Không thể xác minh'
  },
  id: {
    idle: 'Dilindungi dari bot',
    solving: 'Memeriksa bahwa Anda manusia…',
    done: 'Terverifikasi',
    error: 'Gagal memverifikasi'
  },
  ms: {
    idle: 'Dilindungi daripada bot',
    solving: 'Menyemak bahawa anda manusia…',
    done: 'Disahkan',
    error: 'Tidak dapat mengesahkan'
  },
  tl: {
    // review
    idle: 'Protektado laban sa bot',
    solving: 'Tinitiyak na tao ka…',
    done: 'Na-verify',
    error: 'Hindi ma-verify'
  },
  jv: {
    // review
    idle: 'Dilindhungi saka bot',
    solving: 'Mriksa yen panjenengan manungsa…',
    done: 'Wis diverifikasi',
    error: 'Ora bisa diverifikasi'
  },
  su: {
    // review
    idle: 'Ditangtayungan tina bot',
    solving: 'Mariksa yén anjeun manusa…',
    done: 'Diverifikasi',
    error: 'Teu bisa diverifikasi'
  },
  zh: {
    idle: '已启用防机器人保护',
    solving: '正在验证您是否为真人…',
    done: '验证成功',
    error: '无法验证'
  },
  'zh-Hant': {
    idle: '已啟用防機器人保護',
    solving: '正在驗證您是否為真人…',
    done: '驗證成功',
    error: '無法驗證'
  },
  ja: {
    idle: 'ボット対策で保護',
    solving: '人間であることを確認しています…',
    done: '確認済み',
    error: '確認できませんでした'
  },
  ko: {
    idle: '봇으로부터 보호됨',
    solving: '사람인지 확인하는 중…',
    done: '확인됨',
    error: '확인할 수 없음'
  },
  mn: {
    // review
    idle: 'Ботоос хамгаалагдсан',
    solving: 'Таныг хүн эсэхийг шалгаж байна…',
    done: 'Баталгаажлаа',
    error: 'Баталгаажуулж чадсангүй'
  },
  kk: {
    // review
    idle: 'Боттардан қорғалған',
    solving: 'Адам екеніңізді тексеріп жатырмыз…',
    done: 'Расталды',
    error: 'Растау мүмкін болмады'
  },
  ky: {
    // review
    idle: 'Боттордон корголгон',
    solving: 'Адам экениңиз текшерилүүдө…',
    done: 'Ырасталды',
    error: 'Ырастоо мүмкүн болбоду'
  },
  uz: {
    // review
    idle: 'Botlardan himoyalangan',
    solving: 'Inson ekaningiz tekshirilmoqda…',
    done: 'Tasdiqlandi',
    error: 'Tasdiqlab bo‘lmadi'
  },
  tk: {
    // review
    idle: 'Botlardan goralan',
    solving: 'Adamdygyňyz barlanýar…',
    done: 'Tassyklandy',
    error: 'Tassyklap bolmady'
  },
  tg: {
    // review
    idle: 'Аз ботҳо ҳифз шудааст',
    solving: 'Санҷида истодаем, ки шумо инсон ҳастед…',
    done: 'Тасдиқ шуд',
    error: 'Тасдиқ нашуд'
  },
  sw: {
    // review
    idle: 'Imelindwa dhidi ya boti',
    solving: 'Tunathibitisha kuwa wewe ni binadamu…',
    done: 'Imethibitishwa',
    error: 'Imeshindwa kuthibitisha'
  },
  am: {
    // review
    idle: 'ከቦቶች የተጠበቀ',
    solving: 'ሰው መሆንዎን በማረጋገጥ ላይ…',
    done: 'ተረጋግጧል',
    error: 'ማረጋገጥ አልተቻለም'
  },
  om: {
    // review
    idle: 'Bootii irraa eegameera',
    solving: "Nama ta'uu kee mirkaneessaa jirra…",
    done: "Mirkanaa'eera",
    error: "Mirkaneessuun hin danda'amne"
  },
  so: {
    // review
    idle: 'Ka difaacan bots',
    solving: 'Waxaan hubinaynaa inaad tahay qof…',
    done: 'La xaqiijiyay',
    error: 'Lama xaqiijin karin'
  },
  ti: {
    // review
    idle: 'ካብ ቦትታት ዝተሓለወ',
    solving: 'ሰብ ምዃንካ ነረጋግጽ ኣለና…',
    done: 'ተረጋጊጹ',
    error: 'ክረጋገጽ ኣይተኻእለን'
  },
  yo: {
    // review
    idle: 'Ààbò lọ́wọ́ àwọn bọ́ọ̀tì',
    solving: 'À ń ṣàyẹ̀wò pé ènìyàn ni ọ́…',
    done: 'Ti jẹ́rìí sí',
    error: 'Kò ṣeé jẹ́rìí sí'
  },
  ig: {
    // review
    idle: 'E chebere ya pụọ na bọọtụ',
    solving: 'Na-enyocha na ị bụ mmadụ…',
    done: 'Akwadoro',
    error: 'Enweghị ike ịkwado'
  },
  ha: {
    // review
    idle: 'An kare daga bots',
    solving: 'Ana tabbatar da cewa kai mutum ne…',
    done: 'An tabbatar',
    error: 'An kasa tabbatarwa'
  },
  zu: {
    // review
    idle: 'Kuvikelwe kuma-bot',
    solving: 'Siqinisekisa ukuthi ungumuntu…',
    done: 'Kuqinisekisiwe',
    error: 'Akukwazanga ukuqinisekisa'
  },
  xh: {
    // review
    idle: 'Ikhuselwe kwii-bot',
    solving: 'Siqinisekisa ukuba ungumntu…',
    done: 'Kuqinisekisiwe',
    error: 'Akukwazanga ukuqinisekisa'
  },
  st: {
    // review
    idle: 'E sirelletsoe ho li-bot',
    solving: 'Re netefatsa hore o motho…',
    done: 'E netefalitsoe',
    error: 'Ha ea khona ho netefatsoa'
  },
  tn: {
    // review
    idle: 'E sireleditswe mo di-bot',
    solving: 'Re netefatsa gore o motho…',
    done: 'E netefaditswe',
    error: 'Ga e a kgona go netefatsiwa'
  },
  sn: {
    // review
    idle: 'Yakachengetedzwa kubva kumabhoti',
    solving: 'Tiri kusimbisa kuti uri munhu…',
    done: 'Zvasimbiswa',
    error: 'Hazvina kukwanisa kusimbiswa'
  },
  rw: {
    // review
    idle: 'Irinzwe robo',
    solving: 'Turimo kugenzura ko uri umuntu…',
    done: 'Byemejwe',
    error: 'Ntibyashobotse kwemezwa'
  },
  mg: {
    // review
    idle: "Voaaro amin'ny bots",
    solving: 'Manamarina fa olombelona ianao…',
    done: 'Voamarina',
    error: 'Tsy afaka nohamarinina'
  },
  ny: {
    // review
    idle: 'Yotetezedwa ku ma bot',
    solving: 'Tikutsimikizira kuti ndinu munthu…',
    done: 'Zatsimikiziridwa',
    error: 'Sizinatheke kutsimikizira'
  },
  ln: {
    // review
    idle: 'Ebatelami na ba-bot',
    solving: 'Tozali kotala soki ozali moto…',
    done: 'Endimami',
    error: 'Ekoki kondimama te'
  },
  lg: {
    // review
    idle: 'Kikuumibwa ku bbooti',
    solving: 'Tukakasa nti oli muntu…',
    done: 'Kikakasiddwa',
    error: 'Tekisobose kukakasa'
  },
  wo: {
    // review
    idle: 'Aar ci bot yi',
    solving: 'Ñu ngi seet ndax nit nga…',
    done: 'Wóor na',
    error: 'Mënuñu ko wóoral'
  },
  ff: {
    // review
    idle: 'Reenaama e bot',
    solving: 'Ina ƴeewtee so a neɗɗo…',
    done: 'Teeŋtinaama',
    error: 'Waawaa teeŋtineede'
  },
  kg: {
    // review
    idle: 'Me taninama na ba-bot',
    solving: 'Beto ke tala kana nge kele muntu…',
    done: 'Me ndimisama',
    error: 'Ke lendaka ve kundima'
  },
  qu: {
    // review
    idle: 'Botkunamanta amachasqa',
    solving: 'Runa kasqaykita qhawachkan…',
    done: 'Chiqaqchasqa',
    error: 'Mana chiqaqchayta atikurqanchu'
  },
  ay: {
    // review
    idle: "Botanakat jark'aqata",
    solving: 'Jaqïtam uñakipaski…',
    done: 'Chiqanchatawa',
    error: 'Janiw chiqanchañjamäkiti'
  },
  gn: {
    // review
    idle: 'Ñangarekopyre bot-kuéragui',
    solving: 'Jahechajey nde haʼeha yvypóra…',
    done: 'Jehechaukapyre',
    error: 'Ndaikatúi jehechauka'
  },
  ht: {
    // review
    idle: 'Pwoteje kont bòt',
    solving: 'N ap verifye ou se yon moun…',
    done: 'Verifye',
    error: 'Nou pa t kapab verifye'
  },
  eo: {
    idle: 'Protektita kontraŭ robotoj',
    solving: 'Kontrolante, ke vi estas homo…',
    done: 'Kontrolita',
    error: 'Ne eblis kontroli'
  },
  la: {
    // review
    idle: 'Contra automata munitum',
    solving: 'Probamus te hominem esse…',
    done: 'Probatum',
    error: 'Probari non potuit'
  }
}
