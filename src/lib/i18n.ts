// MIZIGO i18n — English-first, Kiswahili-ready (plan §62).
// Core booking-journey copy lives here behind translation keys so Swahili can
// be switched on without touching component code. Remaining surfaces follow
// the same pattern (see docs/ENGINEERING_RULES.md).

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
  // home
  "home.heroTitle": "What are you moving?",
  "home.heroSub": "Tell us the cargo first. We'll pick the right vehicle for it.",
  "home.from": "Pickup location",
  "home.to": "Where should it go?",
  "home.now": "Find a vehicle now",
  "home.schedule": "Choose date & time",
  "home.startDelivery": "Start a delivery",
  "home.recent": "Recent deliveries",
  // tracking
  "track.inProgress": "Delivery in progress",
  "track.shareTracking": "Share tracking",
  // account
  "account.language": "Language",
  "account.english": "English",
  "account.kiswahili": "Kiswahili",
};

const sw: Record<string, string> = {
  // booking flow
  "booking.whatAreYouMoving": "Unaleta nini?",
  "booking.howMuch": "Ni kiasi gani?",
  "booking.pickupTitle": "Tunachukua mzigo wapi?",
  "booking.dropoffTitle": "Inaelekea wapi?",
  "booking.vehicleTitle": "Nini ibebe?",
  "booking.reviewTitle": "Thibitisha usafiri wako",
  "booking.paymentTitle": " Utalipa kwa njia gani?",
  "booking.quotesTitle": "Chagua bei ya dereva",
  "booking.findVehicle": "Tafuta gari",
  "booking.requestVehicle": "Omba gari",
  "booking.priceLocked": "Bei imefungwa wakati wa kubookisha",
  "booking.trustNote": "Safari yako inafuatiliwa kutoka mwanzo hadi mwisho.",
  // home
  "home.heroTitle": "Unaleta nini?",
  "home.heroSub": "Sema mzigo kwanza. Sisi tutachagua gari sahihi.",
  "home.from": "Mahali pa kuchukua",
  "home.to": "Inaelekea wapi?",
  "home.now": "Tafuta gari sasa",
  "home.schedule": "Chagua tarehe na saa",
  "home.startDelivery": "Anza usafiri",
  "home.recent": "Safiri za hivi karibuni",
  // tracking
  "track.inProgress": "Usafiri unaendelea",
  "track.shareTracking": "Shiriki ufuatiliaji",
  // account
  "account.language": "Lugha",
  "account.english": "English",
  "account.kiswahili": "Kiswahili",
};

const dict: Record<Lang, Record<string, string>> = { en, sw };

export function t(key: string, lang: Lang = "en"): string {
  return dict[lang]?.[key] ?? dict.en[key] ?? key;
}

export const LANGUAGES: { key: Lang; label: string }[] = [
  { key: "en", label: "English" },
  { key: "sw", label: "Kiswahili" },
];
