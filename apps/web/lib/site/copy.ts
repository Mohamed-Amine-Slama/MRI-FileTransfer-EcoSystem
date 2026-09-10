import type { UiLocale } from '@mir/contracts';

/**
 * The landing page copy deck — Landing-Page-Specs §5.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT IN lib/i18n/dictionary.ts
 *
 * That dictionary is loaded by every screen in the signed-in application: all
 * three locales, in one module, in the shared chunk. Adding ~140 marketing
 * keys × 3 locales to it would put the landing page's copy in the bundle of
 * every clinical screen, to pay for a page those users have already left.
 *
 * The discipline is identical, though, and deliberately so: `SiteCopy` is
 * derived from the Arabic table and `fr`/`en` are declared as that same type,
 * so omitting a key is a compile error. A locale cannot ship half-translated.
 * `copy.test.ts` adds the runtime half — key parity, no empty values, and the
 * §1.4 claims ban.
 * ---------------------------------------------------------------------------
 *
 * ARABIC IS THE SOURCE, NOT THE TRANSLATION (§5, §16). It is written first and
 * the other two are ports of it. Where the three diverge in rhythm, Arabic is
 * the one that is right.
 *
 * ⚠ REVIEW GATE (§12 L0): this draft has NOT been read by a Libyan native
 * speaker or by a Tunisian one, and §5 is explicit that the register differs
 * between them and that medical vocabulary differs most. It must be reviewed
 * before launch. That gate is recorded in `docs/landing-page-status.md`.
 *
 * NO COUNTRY IS NAMED HERE (§4.3). Lines that need one take it as a parameter
 * and are grouped in `SITE_TEMPLATES` below; the caller resolves the name from
 * the corridor registry through `countryName()`, so configuring a second
 * corridor relabels the page instead of requiring new copy.
 */

const ar = {
  // -- document metadata (§10) ---------------------------------------------
  metaTitle: 'الصورة تصل قبل المريض | نقل الصور الطبية عبر الحدود',
  metaDescription:
    'نقل آمن لصور الرنين المغناطيسي والأشعة المقطعية من عيادتك إلى الطبيب المختص عبر الحدود، بموافقة المريض، ومع موعد محجوز قبل السفر.',
  localeName: 'العربية',

  // -- chrome ---------------------------------------------------------------
  skipToContent: 'تخطي إلى المحتوى',
  navDoctors: 'للأطباء',
  navPatients: 'للمرضى والعائلات',
  navSecurity: 'الأمان',
  navQuestions: 'أسئلة',
  navSignIn: 'تسجيل الدخول',
  menuOpen: 'فتح القائمة',
  menuClose: 'إغلاق القائمة',

  // -- Scene 00 · load ------------------------------------------------------
  loadingLabel: 'جارٍ التحميل',
  loadingSkip: 'اضغط لتخطّي',

  // -- Scene 01 · hero ------------------------------------------------------
  heroHeadline: 'الصورة تصل قبل المريض.',
  heroCtaPrimary: 'سجّل عيادتك',
  heroCtaSecondary: 'شاهد كيف يعمل',
  heroStatusOperational: 'النظام يعمل',
  heroStatusUnknown: 'حالة النظام',
  heroTrustLine: 'نقل مشفّر · سجل غير قابل للتعديل',
  heroScrollHint: 'مرّر للأسفل عبر المقاطع',
  heroSliceCounterLabel: 'موضع المقطع في المجلد',

  // -- Scene 02 · the problem ----------------------------------------------
  problemTitle: 'ثلاثة أشياء تُبطئ كل إحالة.',
  problemCdLabel: 'القرص المضغوط',
  problemCdLine: 'القرص يصل مخدوشًا، أو لا يصل.',
  problemPhoneLabel: 'صور الأفلام',
  problemPhoneLine: 'صور الأفلام على الهاتف ليست فحصًا.',
  problemCalendarLabel: 'الانتظار',
  problemCalendarLine: 'ستة أسابيع لموعد كان يمكن حجزه في يوم واحد.',

  // -- Scene 03 · the corridor ---------------------------------------------
  corridorTitle: 'من غرفة الأشعة إلى غرفة الطبيب المستقبِل.',
  corridorBody:
    'تُرفع الدراسة مرة واحدة من العيادة المُحيلة، وتصل كما هي — البايتات الأصلية دون إعادة ترميز.',
  corridorSourceLabel: 'العيادة المُحيلة',
  corridorDestinationLabel: 'العيادة المستقبِلة',
  corridorReadoutCaption: 'مثال توضيحي لعملية نقل واحدة.',
  corridorMapAlt: 'خريطة تخطيطية للساحل بين بلد المصدر وبلد الوجهة، وخط النقل بينهما.',

  // -- Scene 04 · upload that survives -------------------------------------
  uploadEyebrow: 'الاتصال ينقطع. الرفع لا يبدأ من جديد.',
  uploadTitle: 'جرّب أن تكسره.',
  uploadBody:
    'هذه محاكاة تعمل داخل متصفحك، دون أي اتصال بالشبكة. اقطع الاتصال في أي لحظة وشاهد ما يحدث.',
  uploadCut: 'اقطع الاتصال',
  uploadRestore: 'أعد الاتصال',
  uploadRestart: 'أعد المحاولة من البداية',
  uploadStateIdle: 'جاهز',
  uploadStateUploading: 'جارٍ الرفع',
  uploadStateInterrupted: 'انقطع الاتصال',
  uploadStateComplete: 'اكتمل',
  uploadFilesLabel: 'الملفات',
  uploadRateLabel: 'المعدّل',
  uploadRetryIn: 'إعادة المحاولة خلال',
  uploadSeconds: 'ث',
  uploadResumedLine: 'استؤنف الرفع من حيث توقف. لم تُفقد أي بيانات.',
  uploadCompleteLine: 'اكتمل النقل. تطابقت البصمة الرقمية للدراسة.',
  uploadAnnounceInterrupted: 'انقطع الاتصال. الرفع متوقف مؤقتًا وسيُستأنف تلقائيًا.',
  uploadAnnounceResumed: 'عاد الاتصال. استؤنف الرفع من نفس النقطة دون إعادة إرسال.',
  uploadAnnounceComplete: 'اكتمل الرفع والتحقّق من التطابق.',

  // -- Scene 05 · consent ---------------------------------------------------
  consentTitle: 'الموافقة سجلّ، لا مربّع اختيار.',
  consentBody:
    'يوافق المريض على مشاركة دراسته مع طبيب محدَّد بالاسم. الموافقة مؤرّخة، ومرتبطة بنسخة النص التي قرأها، وقابلة للسحب في أي وقت.',
  consentDocumentTitle: 'موافقة على نقل دراسة طبية عبر الحدود',
  consentDocumentBody:
    'أوافق على نقل دراستي التصويرية إلى الطبيب المذكور أدناه بغرض تحديد موعد وإجراء الاستشارة. أعلم أنني أستطيع سحب هذه الموافقة في أي وقت، وأن الوصول ينتهي فور سحبها.',
  consentGrantedTo: 'الممنوح له',
  consentRecipientRedacted: 'طبيب مستقبِل — الاسم يظهر للمريض',
  consentRevoke: 'سحب الموافقة',
  consentRevokeHint: 'جرّبه. الأثر فوري.',
  consentRevokedNotice: 'سُحبت الموافقة. لم يعد الوصول إلى الدراسة ممكنًا.',
  consentThumbnailsLabel: 'الدراسات المشمولة بهذه الموافقة',
  consentAnnounceRevoked: 'سُحبت الموافقة. أُغلق الوصول إلى الدراسات.',
  consentAnnounceRestored: 'أُعيدت الموافقة. عاد الوصول إلى الدراسات.',

  // -- Scene 06 · the viewer ------------------------------------------------
  viewerTitle: 'التشخيص ليس من عملنا، وهذه ميزة.',
  viewerBanner: 'للعرض المرجعي فقط — ليس للاستخدام التشخيصي.',
  viewerBody:
    'التشخيص يبقى مسؤولية الطبيب على أجهزته المعتمدة. نحن ننقل الصور ونحميها. لا أكثر.',
  viewerScreenshotAlt:
    'لقطة من عارض الصور داخل المنصّة، وفي أعلاه شريط دائم يوضّح أن العرض مرجعي فقط.',

  // -- Scene 07 · the appointment -------------------------------------------
  appointmentTitle: 'الصورة نصف الوعد. الموعد هو النصف الآخر.',
  appointmentBody:
    'يُحجز الموعد قبل سفر المريض، بتوقيت البلدين معًا، فلا أحد يحسب فرق الساعة في رسالة.',
  appointmentSlotLabel: 'الموعد المقترح',
  appointmentConfirmLine: 'تم تثبيت الموعد وإبلاغ الطرفين.',
  appointmentPaymentNote:
    'طريقة الدفع تعتمد على عيادتك — ندعم القنوات التي تعمل فعليًا بين البلدين.',

  // -- Scene 08 · security --------------------------------------------------
  securityTitle: 'ما هو مطبَّق فعليًا، مكتوبًا كما هو.',
  securityAesDesc: 'تشفير البيانات المخزَّنة، بمفاتيح تديرها المنشأة',
  securityTlsDesc: 'تشفير النقل، كحدّ أدنى',
  securityRlsDesc: 'صلاحيات على مستوى الصف داخل قاعدة البيانات، لا في التطبيق فقط',
  securityAuditDesc: 'كل وصول مسجَّل، بالإضافة فقط، ونسخة خارج الموقع',
  securityObjectLockDesc: 'لا يمكن حذف الدراسات الأصلية أو تعديلها',
  securityNoLossyDesc: 'البايتات الأصلية تُحفظ كما هي، دون إعادة ترميز',
  securityMfaDesc: 'إلزامي على كل حساب سريري',
  securityPentestDesc: 'اختبار اختراق مستقل لحدود الصلاحيات، قبل أي بيانات حقيقية',
  securityStatusNote:
    'تسجيل حماية البيانات والتصاريح المتعلقة بالنقل عبر الحدود قيد الإنجاز مع مستشارين قانونيين في البلدين.',

  // -- Scene 09 · two doors -------------------------------------------------
  doorsEyebrow: 'من أنت؟',
  doorsDoctorTitle: 'للأطباء والعيادات',
  doorsDoctorBody: 'تسجيل المنشأة، التحقّق من التراخيص، وكيف تصلك الإحالات.',
  doorsDoctorCta: 'ابدأ تسجيل العيادة',
  doorsPatientTitle: 'للمرضى والعائلات',
  doorsPatientBody: 'ما الذي تحتاج إحضاره، وماذا يحدث بعد ذلك، ومن يرى صورك.',
  doorsPatientCta: 'ما يخصّ المريض',

  // -- Scene 10 · questions -------------------------------------------------
  faqTitle: 'الأسئلة التي تُطرح فعلاً.',
  faqQ1: 'هل ما زال على المريض إحضار القرص المضغوط؟',
  faqA1:
    'لا. تصل الدراسة كاملة قبله. أحضر القرص في المرة الأولى فقط، احتياطًا، حتى تطمئن عيادتك للمسار.',
  faqQ2: 'من يستطيع رؤية صوري؟',
  faqA2:
    'الطبيب المُحيل، والطبيب المستقبِل المذكور بالاسم في الموافقة، ولا أحد غيرهما. كل فتح للملف يُسجَّل باسم من فتحه ووقته، والسجل غير قابل للتعديل.',
  faqQ3: 'ماذا لو انقطع الاتصال أثناء الرفع؟',
  faqA3:
    'يستأنف الرفع من نفس النقطة عند عودة الاتصال. لا يُعاد إرسال ما وصل، ولا يبدأ الملف من الصفر.',
  faqQ4: 'هل يقرأ الطبيب المستقبِل ويشخّص من العارض لديكم؟',
  faqA4:
    'لا. العارض للاستئناس فقط ويحمل هذا التنبيه بشكل دائم. القراءة التشخيصية تتم على أجهزة الطبيب المعتمدة.',
  faqQ5: 'كيف أدفع؟',
  faqA5:
    'تعتمد الطريقة على عيادتك والقنوات المتاحة بين البلدين. تُعرض عليك التكلفة قبل تثبيت أي موعد، ورسوم التنسيق منفصلة عن أي اشتراك.',
  faqQ6: 'هل أستطيع سحب الموافقة بعد الإرسال؟',
  faqA6:
    'نعم، في أي وقت. ينتهي الوصول فورًا ويُسجَّل وقت السحب. ما جرى فتحه قبل ذلك يبقى في السجل — هذا ما يجعله سجلًا.',
  faqQ7: 'كم تبقى الصور محفوظة؟',
  faqA7:
    'تُحفظ الدراسة طوال مدة الحالة والمدة القانونية التي يفرضها بلد العيادة المُحيلة، ثم تُحذف وفق سياسة معلنة لكل منشأة.',
  faqQ8: 'ماذا يحدث لو توقّفت المنصّة عن العمل؟',
  faqA8:
    'يحق لكل منشأة تصدير دراساتها وسجلّها الكامل بصيغة DICOM قياسية في أي وقت، دون طلب. الصور تخصّ العيادة والمريض، لا المنصّة.',

  // -- Scene 11 · close -----------------------------------------------------
  closeLine: 'أرسل الصورة اليوم. ليسافر المريض إلى موعد، لا إلى طابور.',
  closeCta: 'سجّل عيادتك',
  closeSecondary: 'الاطّلاع على الأسعار',

  // -- footer ---------------------------------------------------------------
  footerLanguage: 'اللغة',
  footerLegal: 'الشروط والسياسات',
  footerTerms: 'شروط الخدمة',
  footerPrivacy: 'سياسة الخصوصية',
  footerConsentPolicy: 'سياسة الموافقة',
  footerDataContact: 'مسؤول حماية البيانات',
  footerStatus: 'حالة النظام',
  footerReduceMotion: 'تقليل الحركة في هذا الموقع',
  footerSound: 'الصوت',
  footerSoundOn: 'تشغيل الصوت',
  footerSoundOff: 'كتم الصوت',
  footerCredits: 'الصور المعروضة اصطناعية بالكامل ولا تخصّ أي مريض.',
  footerEntityPending: 'بيانات الكيان القانوني قيد الاستكمال قبل الإطلاق.',
} as const;

export type SiteCopy = { readonly [K in keyof typeof ar]: string };

const fr: SiteCopy = {
  metaTitle: "L'examen arrive avant le patient | Transfert d'imagerie transfrontalier",
  metaDescription:
    "Transfert sécurisé des IRM et scanners de votre cabinet vers un spécialiste de l'autre côté de la frontière — avec le consentement du patient et un rendez-vous réservé avant le déplacement.",
  localeName: 'Français',

  skipToContent: 'Aller au contenu',
  navDoctors: 'Médecins',
  navPatients: 'Patients et familles',
  navSecurity: 'Sécurité',
  navQuestions: 'Questions',
  navSignIn: 'Se connecter',
  menuOpen: 'Ouvrir le menu',
  menuClose: 'Fermer le menu',

  loadingLabel: 'Chargement',
  loadingSkip: 'Appuyez pour passer',

  heroHeadline: "L'examen arrive avant le patient.",
  heroCtaPrimary: 'Inscrire votre cabinet',
  heroCtaSecondary: 'Voir comment ça marche',
  heroStatusOperational: 'Système opérationnel',
  heroStatusUnknown: 'État du système',
  heroTrustLine: 'Transfert chiffré · Journal inaltérable',
  heroScrollHint: 'Faites défiler à travers les coupes',
  heroSliceCounterLabel: 'Position de la coupe dans le volume',

  problemTitle: 'Trois choses ralentissent chaque orientation.',
  problemCdLabel: 'Le CD',
  problemCdLine: "Le CD arrive rayé, ou il n'arrive pas.",
  problemPhoneLabel: 'Les photos de films',
  problemPhoneLine: "Des photos de films ne sont pas un examen.",
  problemCalendarLabel: "L'attente",
  problemCalendarLine:
    "Six semaines pour un rendez-vous qui aurait pu être pris en un jour.",

  corridorTitle: "De la salle d'examen au cabinet qui reçoit.",
  corridorBody:
    "L'étude est téléversée une fois depuis le cabinet qui oriente, et arrive telle quelle — les octets d'origine, sans réencodage.",
  corridorSourceLabel: 'Cabinet qui oriente',
  corridorDestinationLabel: 'Cabinet destinataire',
  corridorReadoutCaption: "Illustration d'un transfert.",
  corridorMapAlt:
    "Carte au trait du littoral entre le pays d'origine et le pays de destination, avec la ligne de transfert.",

  uploadEyebrow: 'La connexion tombe. Le téléversement ne recommence pas.',
  uploadTitle: 'Essayez de le casser.',
  uploadBody:
    "Cette simulation tourne dans votre navigateur, sans aucun appel réseau. Coupez la connexion quand vous voulez et regardez.",
  uploadCut: 'Couper la connexion',
  uploadRestore: 'Rétablir la connexion',
  uploadRestart: 'Recommencer',
  uploadStateIdle: 'Prêt',
  uploadStateUploading: 'Téléversement',
  uploadStateInterrupted: 'Connexion coupée',
  uploadStateComplete: 'Terminé',
  uploadFilesLabel: 'Fichiers',
  uploadRateLabel: 'Débit',
  uploadRetryIn: 'Nouvelle tentative dans',
  uploadSeconds: 's',
  uploadResumedLine: "Repris exactement où il s'était arrêté. Rien de renvoyé.",
  uploadCompleteLine: "Transfert terminé. L'empreinte de l'étude correspond.",
  uploadAnnounceInterrupted:
    'Connexion coupée. Le téléversement est en pause et reprendra automatiquement.',
  uploadAnnounceResumed:
    'Connexion rétablie. Le téléversement a repris au même point, sans rien renvoyer.',
  uploadAnnounceComplete: 'Téléversement terminé et empreinte vérifiée.',

  consentTitle: "Le consentement est un registre, pas une case à cocher.",
  consentBody:
    "Le patient consent à partager son étude avec un médecin nommé. Le consentement est horodaté, lié à la version du texte qu'il a lue, et révocable à tout moment.",
  consentDocumentTitle: "Consentement au transfert transfrontalier d'une étude médicale",
  consentDocumentBody:
    "J'accepte le transfert de mon étude d'imagerie au médecin nommé ci-dessous, aux fins de prise de rendez-vous et de consultation. Je sais que je peux retirer ce consentement à tout moment et que l'accès cesse immédiatement.",
  consentGrantedTo: 'Accordé à',
  consentRecipientRedacted: 'Médecin destinataire — le nom est affiché au patient',
  consentRevoke: 'Révoquer',
  consentRevokeHint: "Essayez. L'effet est immédiat.",
  consentRevokedNotice: "Consentement révoqué. L'étude n'est plus accessible.",
  consentThumbnailsLabel: 'Études couvertes par ce consentement',
  consentAnnounceRevoked: "Consentement révoqué. L'accès aux études est fermé.",
  consentAnnounceRestored: "Consentement rétabli. L'accès aux études est rouvert.",

  viewerTitle: "Le diagnostic n'est pas notre métier, et c'est voulu.",
  viewerBanner: 'Visualisation de référence uniquement — non destinée au diagnostic.',
  viewerBody:
    'Le diagnostic reste au médecin, sur son propre matériel validé. Nous déplaçons les images et nous les protégeons. Rien de plus.',
  viewerScreenshotAlt:
    "Capture de la visionneuse intégrée, avec en tête un bandeau permanent indiquant que la visualisation est de référence uniquement.",

  appointmentTitle: "L'examen est la moitié de la promesse. Le rendez-vous est l'autre moitié.",
  appointmentBody:
    "Le rendez-vous est pris avant le départ du patient, affiché dans les deux fuseaux, pour que personne ne calcule l'heure dans un message.",
  appointmentSlotLabel: 'Créneau proposé',
  appointmentConfirmLine: 'Rendez-vous confirmé et les deux parties notifiées.',
  appointmentPaymentNote:
    'Le moyen de paiement dépend de votre cabinet — nous prenons en charge les canaux qui fonctionnent réellement entre les deux pays.',

  securityTitle: "Ce qui est réellement en place, écrit tel quel.",
  securityAesDesc: 'chiffrement au repos, clés gérées par le client',
  securityTlsDesc: 'en transit, au minimum',
  securityRlsDesc: "appliquée dans la base de données, pas seulement dans l'application",
  securityAuditDesc: 'chaque accès enregistré, en ajout seul, copie hors site',
  securityObjectLockDesc: "les études originales ne peuvent être ni supprimées ni modifiées",
  securityNoLossyDesc: "les octets d'origine sont conservés à l'identique",
  securityMfaDesc: 'obligatoire sur chaque compte clinique',
  securityPentestDesc: "des limites d'autorisation, avant tout patient réel",
  securityStatusNote:
    "L'enregistrement en protection des données et les autorisations de transfert transfrontalier sont en cours avec des conseils juridiques dans les deux pays.",

  doorsEyebrow: 'Vous êtes ?',
  doorsDoctorTitle: 'Médecins et cabinets',
  doorsDoctorBody:
    "Inscription de l'établissement, vérification des licences, et comment les orientations vous parviennent.",
  doorsDoctorCta: 'Inscrire le cabinet',
  doorsPatientTitle: 'Patients et familles',
  doorsPatientBody:
    "Ce qu'il faut apporter, ce qui se passe ensuite, et qui voit vos images.",
  doorsPatientCta: 'Côté patient',

  faqTitle: 'Les questions qui se posent vraiment.',
  faqQ1: 'Le patient doit-il encore apporter le CD ?',
  faqA1:
    "Non. L'étude complète arrive avant lui. Apportez le CD la première fois seulement, par précaution, le temps que votre cabinet prenne confiance.",
  faqQ2: 'Qui peut voir mes images ?',
  faqA2:
    "Le médecin qui oriente, le médecin destinataire nommé dans le consentement, et personne d'autre. Chaque ouverture est enregistrée avec le nom et l'heure, dans un journal qui ne peut pas être modifié.",
  faqQ3: 'Et si ma connexion tombe pendant le téléversement ?',
  faqA3:
    "Il reprend au même point dès le retour de la connexion. Ce qui est arrivé n'est pas renvoyé et le fichier ne repart pas de zéro.",
  faqQ4: 'Le médecin destinataire lit-il et pose-t-il le diagnostic depuis votre visionneuse ?',
  faqA4:
    "Non. La visionneuse est de référence uniquement et porte ce bandeau en permanence. La lecture diagnostique se fait sur le matériel validé du médecin.",
  faqQ5: 'Comment payer ?',
  faqA5:
    "Cela dépend de votre cabinet et des canaux disponibles entre les deux pays. Le coût vous est présenté avant toute confirmation de rendez-vous, et les frais de coordination sont séparés de tout abonnement.",
  faqQ6: 'Puis-je retirer mon consentement après envoi ?',
  faqA6:
    "Oui, à tout moment. L'accès cesse immédiatement et l'heure du retrait est enregistrée. Ce qui a été ouvert avant reste au journal — c'est ce qui en fait un journal.",
  faqQ7: 'Combien de temps les images sont-elles conservées ?',
  faqA7:
    "Le temps du dossier et de la durée légale exigée par le pays du cabinet qui oriente, puis supprimées selon une politique publiée par établissement.",
  faqQ8: "Que se passe-t-il si la plateforme s'arrête ?",
  faqA8:
    "Chaque établissement peut exporter ses études et son journal complet au format DICOM standard, à tout moment et sans le demander. Les images appartiennent au cabinet et au patient, pas à la plateforme.",

  closeLine:
    "Envoyez l'examen aujourd'hui. Que votre patient voyage vers un rendez-vous, pas vers une file d'attente.",
  closeCta: 'Inscrire votre cabinet',
  closeSecondary: 'Voir les tarifs',

  footerLanguage: 'Langue',
  footerLegal: 'Conditions et politiques',
  footerTerms: "Conditions d'utilisation",
  footerPrivacy: 'Politique de confidentialité',
  footerConsentPolicy: 'Politique de consentement',
  footerDataContact: 'Délégué à la protection des données',
  footerStatus: 'État du système',
  footerReduceMotion: 'Réduire les animations sur ce site',
  footerSound: 'Son',
  footerSoundOn: 'Activer le son',
  footerSoundOff: 'Couper le son',
  footerCredits:
    "Les images affichées sont entièrement synthétiques et n'appartiennent à aucun patient.",
  footerEntityPending: "Les informations de l'entité légale seront complétées avant le lancement.",
};

const en: SiteCopy = {
  metaTitle: 'Their scan arrives before they do | Cross-border imaging transfer',
  metaDescription:
    'Secure transfer of MRI and CT studies from your clinic to a specialist across the border — with the patient’s consent, and an appointment booked before they travel.',
  localeName: 'English',

  skipToContent: 'Skip to content',
  navDoctors: 'Doctors',
  navPatients: 'Patients and families',
  navSecurity: 'Security',
  navQuestions: 'Questions',
  navSignIn: 'Sign in',
  menuOpen: 'Open menu',
  menuClose: 'Close menu',

  loadingLabel: 'Loading',
  loadingSkip: 'Press to skip',

  heroHeadline: 'Their scan arrives before they do.',
  heroCtaPrimary: 'Register your clinic',
  heroCtaSecondary: 'See how it works',
  heroStatusOperational: 'System operational',
  heroStatusUnknown: 'System status',
  heroTrustLine: 'Encrypted transfer · Immutable audit log',
  heroScrollHint: 'Scroll through the slices',
  heroSliceCounterLabel: 'Slice position in the volume',

  problemTitle: 'Three things slow every referral down.',
  problemCdLabel: 'The CD',
  problemCdLine: 'The CD arrives scratched, or it doesn’t arrive.',
  problemPhoneLabel: 'Photographs of films',
  problemPhoneLine: 'Photographs of films are not a study.',
  problemCalendarLabel: 'The wait',
  problemCalendarLine: 'Six weeks for an appointment that could have been booked in a day.',

  corridorTitle: 'From the scanner room to the doctor who receives it.',
  corridorBody:
    'The study is uploaded once from the referring clinic and arrives as it left — the original bytes, with no re-encoding.',
  corridorSourceLabel: 'Referring clinic',
  corridorDestinationLabel: 'Receiving clinic',
  corridorReadoutCaption: 'Illustration of one transfer.',
  corridorMapAlt:
    'Line map of the coastline between the source country and the destination country, with the transfer route drawn between them.',

  uploadEyebrow: 'The connection drops. The upload does not start again.',
  uploadTitle: 'Try to break it.',
  uploadBody:
    'This simulation runs in your browser with no network calls at all. Cut the connection whenever you like and watch what happens.',
  uploadCut: 'Cut the connection',
  uploadRestore: 'Restore the connection',
  uploadRestart: 'Start over',
  uploadStateIdle: 'Ready',
  uploadStateUploading: 'Uploading',
  uploadStateInterrupted: 'Connection cut',
  uploadStateComplete: 'Complete',
  uploadFilesLabel: 'Files',
  uploadRateLabel: 'Rate',
  uploadRetryIn: 'Retrying in',
  uploadSeconds: 's',
  uploadResumedLine: 'Resumed exactly where it stopped. Nothing re-sent.',
  uploadCompleteLine: 'Transfer complete. The study’s checksum matched.',
  uploadAnnounceInterrupted:
    'Connection cut. The upload is paused and will resume automatically.',
  uploadAnnounceResumed:
    'Connection restored. The upload resumed at the same point with nothing re-sent.',
  uploadAnnounceComplete: 'Upload complete and checksum verified.',

  consentTitle: 'Consent is a record, not a checkbox.',
  consentBody:
    'The patient consents to sharing their study with one named doctor. The consent is timestamped, bound to the version of the text they read, and revocable at any time.',
  consentDocumentTitle: 'Consent to cross-border transfer of a medical study',
  consentDocumentBody:
    'I agree to my imaging study being transferred to the doctor named below, for the purpose of booking an appointment and being seen. I understand I can withdraw this consent at any time, and that access ends immediately when I do.',
  consentGrantedTo: 'Granted to',
  consentRecipientRedacted: 'Receiving doctor — the name is shown to the patient',
  consentRevoke: 'Revoke',
  consentRevokeHint: 'Try it. The effect is immediate.',
  consentRevokedNotice: 'Consent revoked. The study is no longer reachable.',
  consentThumbnailsLabel: 'Studies covered by this consent',
  consentAnnounceRevoked: 'Consent revoked. Access to the studies is closed.',
  consentAnnounceRestored: 'Consent restored. Access to the studies is open again.',

  viewerTitle: 'Diagnosis is not our job, and that is the point.',
  viewerBanner: 'Reference viewing only — not for diagnostic use.',
  viewerBody:
    'The diagnosis stays with the doctor, on their own validated equipment. We move the images and protect them. Nothing else.',
  viewerScreenshotAlt:
    'The in-product image viewer, with a permanent banner across the top stating that viewing is for reference only.',

  appointmentTitle: 'The scan is half the promise. The appointment is the other half.',
  appointmentBody:
    'The appointment is booked before the patient travels, shown in both timezones, so nobody is doing the arithmetic in a message.',
  appointmentSlotLabel: 'Proposed slot',
  appointmentConfirmLine: 'Appointment confirmed and both sides notified.',
  appointmentPaymentNote:
    'Payment method depends on your clinic — we support the rails that actually work between the two countries.',

  securityTitle: 'What is actually in place, written as it is.',
  securityAesDesc: 'encryption at rest, customer-managed keys',
  securityTlsDesc: 'in transit, minimum',
  securityRlsDesc: 'enforced in the database, not just the app',
  securityAuditDesc: 'every access recorded, append-only, offsite',
  securityObjectLockDesc: 'original studies cannot be deleted or altered',
  securityNoLossyDesc: 'original bytes preserved exactly',
  securityMfaDesc: 'required on every clinical account',
  securityPentestDesc: 'authorization boundaries, before real patients',
  securityStatusNote:
    'Data protection registration and cross-border authorisation are in progress with counsel in both countries.',

  doorsEyebrow: 'Which are you?',
  doorsDoctorTitle: 'Doctors and clinics',
  doorsDoctorBody:
    'Clinic registration, licence verification, and how referrals reach you.',
  doorsDoctorCta: 'Start clinic registration',
  doorsPatientTitle: 'Patients and families',
  doorsPatientBody: 'What to bring, what happens next, and who sees your images.',
  doorsPatientCta: 'The patient side',

  faqTitle: 'The questions people actually ask.',
  faqQ1: 'Does the patient still need to bring the CD?',
  faqA1:
    'No. The whole study arrives before they do. Bring the CD the first time anyway, as a belt-and-braces measure, until your clinic trusts the route.',
  faqQ2: 'Who can see my images?',
  faqA2:
    'The referring doctor, the receiving doctor named in the consent, and nobody else. Every opening is recorded with who and when, in a log that cannot be edited.',
  faqQ3: 'What if my connection drops during upload?',
  faqA3:
    'It resumes at the same point when the connection returns. What already arrived is not re-sent, and the file does not start again from zero.',
  faqQ4: 'Is the receiving doctor reading and diagnosing from your viewer?',
  faqA4:
    'No. The viewer is for reference only and carries that banner permanently. The diagnostic read happens on the doctor’s own validated equipment.',
  faqQ5: 'How do I pay?',
  faqA5:
    'It depends on your clinic and the rails available between the two countries. The cost is shown to you before any appointment is confirmed, and coordination fees are separate from any subscription.',
  faqQ6: 'Can I withdraw consent after sending?',
  faqA6:
    'Yes, at any time. Access ends immediately and the time of withdrawal is recorded. What was opened before that stays in the log — which is what makes it a log.',
  faqQ7: 'How long are images kept?',
  faqA7:
    'For the life of the case and the retention period the referring clinic’s country requires, then deleted under a published per-organisation policy.',
  faqQ8: 'What happens if the platform shuts down?',
  faqA8:
    'Every organisation can export its studies and its full log in standard DICOM format, at any time, without asking. The images belong to the clinic and the patient, not to the platform.',

  closeLine: 'Send the scan today, so your patient travels to an appointment, not to a queue.',
  closeCta: 'Register your clinic',
  closeSecondary: 'See pricing',

  footerLanguage: 'Language',
  footerLegal: 'Terms and policies',
  footerTerms: 'Terms of service',
  footerPrivacy: 'Privacy policy',
  footerConsentPolicy: 'Consent policy',
  footerDataContact: 'Data protection contact',
  footerStatus: 'System status',
  footerReduceMotion: 'Reduce motion on this site',
  footerSound: 'Sound',
  footerSoundOn: 'Turn sound on',
  footerSoundOff: 'Mute sound',
  footerCredits: 'The imagery shown is entirely synthetic and belongs to no patient.',
  footerEntityPending: 'Legal entity details are being completed before launch.',
};

export const SITE_COPY: Record<UiLocale, SiteCopy> = { ar, fr, en };

/**
 * Lines that name a country.
 *
 * §4.3 forbids UI copy that assumes a specific corridor, so these take the
 * names as arguments and the caller resolves them from the corridor registry
 * via `countryName()`. Functions rather than a template mini-language, for the
 * same reason `lib/i18n/dictionary.ts` gives: a placeholder syntax is one more
 * thing to get wrong in a direction-sensitive layout.
 */
interface SiteTemplates {
  /** Hero subhead — §5. */
  heroSubhead: (source: string, destination: string) => string;
  /** Scene 03 — the route, stated as a sentence for screen readers. */
  corridorRoute: (source: string, destination: string) => string;
  /** Scene 05 — the consent recipient line. */
  consentRecipient: (destination: string) => string;
  /** Scene 07 — a clock label. */
  clockLabel: (country: string) => string;
}

export const SITE_TEMPLATES: Record<UiLocale, SiteTemplates> = {
  ar: {
    heroSubhead: (s, d) =>
      `نقل آمن لصور الرنين المغناطيسي والأشعة المقطعية من عيادتك في ${s} إلى الطبيب المختص في ${d} — بموافقة المريض، ومع موعد محجوز قبل السفر.`,
    corridorRoute: (s, d) => `من ${s} إلى ${d}`,
    consentRecipient: (d) => `طبيب مستقبِل في ${d}`,
    clockLabel: (c) => `التوقيت في ${c}`,
  },
  fr: {
    heroSubhead: (s, d) =>
      `Transfert sécurisé des IRM et scanners de votre cabinet en ${s} vers un spécialiste en ${d} — avec le consentement du patient et un rendez-vous réservé avant le déplacement.`,
    corridorRoute: (s, d) => `De ${s} vers ${d}`,
    consentRecipient: (d) => `Médecin destinataire en ${d}`,
    clockLabel: (c) => `Heure en ${c}`,
  },
  en: {
    heroSubhead: (s, d) =>
      `Secure transfer of MRI and CT studies from your clinic in ${s} to a specialist in ${d} — with the patient’s consent, and an appointment booked before they travel.`,
    corridorRoute: (s, d) => `From ${s} to ${d}`,
    consentRecipient: (d) => `Receiving doctor in ${d}`,
    clockLabel: (c) => `Time in ${c}`,
  },
};

/**
 * The security readout's left column — §Scene 08.
 *
 * Deliberately NOT translated. These are the names of the things themselves;
 * "AES-256" is not an English word and rendering it in three scripts would
 * make a technical readout look like marketing. The descriptions beside them
 * are translated, because those are sentences.
 *
 * Every line is a real thing from BUILD_SPEC. A ninth line that is not yet
 * true is what would make the other eight worthless.
 */
export const SECURITY_ROWS: readonly { term: string; descKey: keyof SiteCopy }[] = [
  { term: 'AES-256', descKey: 'securityAesDesc' },
  { term: 'TLS 1.3', descKey: 'securityTlsDesc' },
  { term: 'Row-level security', descKey: 'securityRlsDesc' },
  { term: 'Immutable audit log', descKey: 'securityAuditDesc' },
  { term: 'Object Lock', descKey: 'securityObjectLockDesc' },
  { term: 'No lossy re-encoding', descKey: 'securityNoLossyDesc' },
  { term: 'MFA', descKey: 'securityMfaDesc' },
  { term: 'Independent pen test', descKey: 'securityPentestDesc' },
];

/** The eight questions of §Scene 10, in order. Eight, and no more. */
export const FAQ_ROWS: readonly { q: keyof SiteCopy; a: keyof SiteCopy }[] = [
  { q: 'faqQ1', a: 'faqA1' },
  { q: 'faqQ2', a: 'faqA2' },
  { q: 'faqQ3', a: 'faqA3' },
  { q: 'faqQ4', a: 'faqA4' },
  { q: 'faqQ5', a: 'faqA5' },
  { q: 'faqQ6', a: 'faqA6' },
  { q: 'faqQ7', a: 'faqA7' },
  { q: 'faqQ8', a: 'faqA8' },
];
