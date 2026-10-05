// MIZIGO i18n — English + Kiswahili (plan §62).
// Customer-app copy lives behind translation keys so Kiswahili can be switched
// on without touching component code. Driver + admin consoles stay English
// (operator-facing). The public tracking link stays English for universal
// readability. See docs/ENGINEERING_RULES.md.

export type Lang = "en" | "sw";

const en: Record<string, string> = {
  // booking flow
  "booking.whatAreYouMoving": "What are you moving?",
  "booking.howMuch": "How much are you moving?",
  "booking.pickupTitle": "Where are we picking up?",
  "booking.dropoffTitle": "Where is it going?",
  "booking.vehicleTitle": "What should carry it?",
  "booking.reviewTitle": "Confirm your delivery",
  "booking.paymentTitle": "How would you like to pay?",
  "booking.quotesTitle": "Choose your driver's quote",
  "booking.findVehicle": "Find a vehicle",
  "booking.requestVehicle": "Request vehicle",
  "booking.priceLocked": "Price locked at booking",
  "booking.trustNote": "Your trip is tracked from pickup to delivery.",
  // cargo step
  "cargo.addItems": "Add items",
  "cargo.itemHint": "Tap what you're moving. Quantities matter more than weights.",
  "cargo.notSure": "Not sure about the size? Estimate — your driver can confirm before loading.",
  // vehicle step
  "vehicle.bestMatch": "Best match for your cargo",
  "vehicle.alternatives": "Alternatives",
  "vehicle.fits": "Fits your cargo",
  // payment
  "payment.mpesa": "M-PESA",
  "payment.cash": "Cash",
  "payment.card": "Card",
  "payment.checkPhone": "Check your phone",
  // matching
  "matching.finding": "Finding a vehicle…",
  "matching.driverFound": "Driver found",
  "matching.call": "Call",
  "matching.message": "Message",
  "matching.verifyPlate": "Verify the vehicle plate before loading",
  // active trip
  "active.chat": "Chat",
  "active.share": "Share",
  "active.help": "Get help",
  "active.cancelDelivery": "Cancel this delivery",
  "active.deliveryCode": "Delivery code",
  // rating
  "rate.title": "How was your delivery?",
  "rate.submit": "Submit rating",
  // home
  "home.heroTitle": "What are you moving?",
  "home.heroSub": "Tell us the cargo first. We'll pick the right vehicle for it.",
  "home.from": "Pickup location",
  "home.to": "Where should it go?",
  "home.now": "Find a vehicle now",
  "home.schedule": "Choose date & time",
  "home.startDelivery": "Start a delivery",
  "home.recent": "Recent deliveries",
  "home.noDeliveries": "No deliveries yet",
  "home.noDeliveriesBody": "You'll see your completed deliveries here.",
  "home.moveSomething": "Move something",
  "home.allDeliveries": "All deliveries",
  // nav tabs
  "nav.home": "Home",
  "nav.trips": "Deliveries",
  "nav.wallet": "Wallet",
  "nav.account": "Account",
  // trips
  "trips.title": "Your deliveries",
  "trips.all": "All",
  "trips.active": "Active",
  "trips.completed": "Completed",
  "trips.cancelled": "Cancelled",
  "trips.empty": "No deliveries here",
  "trips.trackLive": "Track delivery live",
  "trips.bookAgain": "Book again",
  "trips.shareTracking": "Share tracking",
  "trips.rateDelivery": "Rate this delivery",
  // wallet
  "wallet.title": "Wallet & payments",
  "wallet.notifications": "Notifications",
  "wallet.caughtUp": "You're all caught up",
  "wallet.caughtUpBody": "Delivery updates will appear here.",
  // account
  "account.language": "Language",
  "account.english": "English",
  "account.kiswahili": "Kiswahili",
  "account.helpSupport": "Help & support",
  "account.safetyCentre": "Safety centre",
  "account.logOut": "Log out",
  // return-load deals (v1 goodness)
  "deals.title": "Return-load deals",
  "deals.sub": "Vehicles already heading that way · empty-leg prices",
  "deals.badge": "Empty-leg deal",
  "deals.capacity": "Capacity",
  "deals.verified": "Verified operator",
  "deals.emptyLegPrice": "Empty-leg price",
  "deals.explain": "This vehicle is already returning empty — you both win.",
  "deals.reserve": "Reserve this leg",
};

const sw: Record<string, string> = {
  // booking flow
  "booking.whatAreYouMoving": "Unaleta nini?",
  "booking.howMuch": "Ni kiasi gani?",
  "booking.pickupTitle": "Tunachukua mzigo wapi?",
  "booking.dropoffTitle": "Inaelekea wapi?",
  "booking.vehicleTitle": "Nini ibebe?",
  "booking.reviewTitle": "Thibitisha usafiri wako",
  "booking.paymentTitle": "Utalipa kwa njia gani?",
  "booking.quotesTitle": "Chagua bei ya dereva",
  "booking.findVehicle": "Tafuta gari",
  "booking.requestVehicle": "Omba gari",
  "booking.priceLocked": "Bei imefungwa wakati wa kubookisha",
  "booking.trustNote": "Safari yako inafuatiliwa kutoka mwanzo hadi mwisho.",
  // cargo step
  "cargo.addItems": "Ongeza bidhaa",
  "cargo.itemHint": "Bonyeza unachohamisha. Idadi ni muhimu kuliko uzito.",
  "cargo.notSure": "Hujui ukubwa? Kadiria — dereva anaweza kuthibitisha kabla ya kupakia.",
  // vehicle step
  "vehicle.bestMatch": "Nafasi bora kwa mzigo wako",
  "vehicle.alternatives": "Chaguo nyingine",
  "vehicle.fits": "Inatosha kwa mzigo wako",
  // payment
  "payment.mpesa": "M-PESA",
  "payment.cash": "Pesa taslimu",
  "payment.card": "Kadi",
  "payment.checkPhone": "Angalia simu yako",
  // matching
  "matching.finding": "Inatafuta gari…",
  "matching.driverFound": "Dereva amepatikana",
  "matching.call": "Piga simu",
  "matching.message": "Ujumbe",
  "matching.verifyPlate": "Hakiki namba ya gari kabla ya kupakia",
  // active trip
  "active.chat": "Mazungumzo",
  "active.share": "Shiriki",
  "active.help": "Pata msaada",
  "active.cancelDelivery": "Ghairi usafiri huu",
  "active.deliveryCode": "Msimbo wa usafiri",
  // rating
  "rate.title": "Usafiri ulikuwaje?",
  "rate.submit": "Tuma maoni",
  // home
  "home.heroTitle": "Unaleta nini?",
  "home.heroSub": "Sema mzigo kwanza. Sisi tutachagua gari sahihi.",
  "home.from": "Mahali pa kuchukua",
  "home.to": "Inaelekea wapi?",
  "home.now": "Tafuta gari sasa",
  "home.schedule": "Chagua tarehe na saa",
  "home.startDelivery": "Anza usafiri",
  "home.recent": "Safari za hivi karibuni",
  "home.noDeliveries": "Bado hakuna safari",
  "home.noDeliveriesBody": "Safari zilizokamilika zitaonekana hapa.",
  "home.moveSomething": "Hamisha kitu",
  "home.allDeliveries": "Safari zote",
  // nav tabs
  "nav.home": "Nyumbani",
  "nav.trips": "Safari",
  "nav.wallet": "Pochi",
  "nav.account": "Akaunti",
  // trips
  "trips.title": "Safari zako",
  "trips.all": "Zote",
  "trips.active": "Zinaendelea",
  "trips.completed": "Zilizokamilika",
  "trips.cancelled": "Zilizoghairiwa",
  "trips.empty": "Hakuna safari hapa",
  "trips.trackLive": "Fuatilia safari",
  "trips.bookAgain": "Bookisha tena",
  "trips.shareTracking": "Shiriki ufuatiliaji",
  "trips.rateDelivery": "Kadiria usafiri huu",
  // wallet
  "wallet.title": "Pochi na malipo",
  "wallet.notifications": "Taarifa",
  "wallet.caughtUp": "Hakuna taarifa mpya",
  "wallet.caughtUpBody": "Taarifa za safari zitaonekana hapa.",
  // account
  "account.language": "Lugha",
  "account.english": "English",
  "account.kiswahili": "Kiswahili",
  "account.helpSupport": "Msaada na usaidizi",
  "account.safetyCentre": "Kituo cha usalama",
  "account.logOut": "Toka",
  // return-load deals (v1 goodness)
  "deals.title": "Safari za kurudi",
  "deals.sub": "Magari yanayoenda hiyo njia · bei nafuu",
  "deals.badge": "Bei ya kurudi",
  "deals.capacity": "Uwezo",
  "deals.verified": "Dereva aliyethibitishwa",
  "deals.emptyLegPrice": "Bei ya kurudi",
  "deals.explain": "Gari hili linarudi likiwa tupu — mnunuzi nyingine? Faida mnazipata nyote.",
  "deals.reserve": "Shika nafasi hii",
};

const dict: Record<Lang, Record<string, string>> = { en, sw };

export function t(key: string, lang: Lang = "en"): string {
  return dict[lang]?.[key] ?? dict.en[key] ?? key;
}

export const LANGUAGES: { key: Lang; label: string }[] = [
  { key: "en", label: "English" },
  { key: "sw", label: "Kiswahili" },
];
