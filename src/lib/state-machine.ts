// MIZIGO — Shipment state machine. Single source of truth, server-validated.
// The client may only request named transitions; this module guards legality,
// allowed actor roles, and appends chain-of-custody events.

export type ShipmentState =
  | "DRAFT" | "PRICED" | "QUOTED" | "PAYMENT_PENDING" | "PAYMENT_CONFIRMED"
  | "MATCHING" | "DRIVER_ASSIGNED" | "DRIVER_EN_ROUTE" | "DRIVER_ARRIVED"
  | "LOADING" | "LOADED" | "IN_TRANSIT" | "ARRIVING" | "DELIVERED"
  | "POD_CONFIRMED" | "COMPLETED"
  // side states
  | "CANCELLED" | "NO_DRIVERS" | "DISPUTED";

export type Role = "CUSTOMER" | "DRIVER" | "ADMIN" | "SYSTEM";

export interface TransitionRule {
  from: ShipmentState[];
  to: ShipmentState;
  action: string; // API action name
  actors: Role[];
  label: string; // human-readable event label
  type: string; // ShipmentEvent.type
}

export const TRANSITIONS: TransitionRule[] = [
  { from: ["PRICED"], to: "QUOTED", action: "request-quotes", actors: ["CUSTOMER", "ADMIN"], label: "Driver quotes requested", type: "QUOTES_REQUESTED" },
  { from: ["QUOTED"], to: "PAYMENT_PENDING", action: "accept-quote", actors: ["CUSTOMER", "ADMIN"], label: "Quote accepted · fare locked", type: "QUOTE_ACCEPTED" },
  { from: ["PRICED", "PAYMENT_PENDING"], to: "PAYMENT_CONFIRMED", action: "payment-confirmed", actors: ["SYSTEM"], label: "Payment confirmed", type: "PAYMENT_CONFIRMED" },
  { from: ["PRICED", "PAYMENT_CONFIRMED"], to: "MATCHING", action: "request", actors: ["CUSTOMER", "ADMIN"], label: "Finding a vehicle", type: "MATCHING_STARTED" },
  { from: ["MATCHING"], to: "DRIVER_ASSIGNED", action: "assign", actors: ["SYSTEM"], label: "Driver matched", type: "DRIVER_ASSIGNED" },
  { from: ["DRIVER_ASSIGNED"], to: "DRIVER_EN_ROUTE", action: "driver-accept", actors: ["DRIVER"], label: "Driver accepted · on the way to pickup", type: "DRIVER_ACCEPTED" },
  { from: ["DRIVER_EN_ROUTE"], to: "DRIVER_ARRIVED", action: "arrive", actors: ["DRIVER"], label: "Driver arrived at pickup", type: "DRIVER_ARRIVED" },
  { from: ["DRIVER_ARRIVED"], to: "LOADING", action: "start-loading", actors: ["DRIVER"], label: "Loading started", type: "LOADING_STARTED" },
  { from: ["LOADING"], to: "LOADED", action: "loaded", actors: ["DRIVER"], label: "Cargo loaded and verified", type: "CARGO_LOADED" },
  { from: ["LOADED"], to: "IN_TRANSIT", action: "start-trip", actors: ["DRIVER"], label: "Delivery started", type: "TRIP_STARTED" },
  { from: ["IN_TRANSIT"], to: "ARRIVING", action: "arriving", actors: ["SYSTEM", "DRIVER"], label: "Approaching destination", type: "ARRIVING" },
  { from: ["IN_TRANSIT", "ARRIVING"], to: "DELIVERED", action: "deliver", actors: ["DRIVER"], label: "Destination reached · unloading", type: "DESTINATION_REACHED" },
  { from: ["DELIVERED"], to: "POD_CONFIRMED", action: "pod", actors: ["DRIVER", "SYSTEM"], label: "Proof of delivery captured", type: "POD_CONFIRMED" },
  { from: ["POD_CONFIRMED", "DELIVERED"], to: "COMPLETED", action: "complete", actors: ["SYSTEM", "DRIVER"], label: "Delivery completed · receipt ready", type: "COMPLETED" },
  { from: ["MATCHING"], to: "NO_DRIVERS", action: "matching-failed", actors: ["SYSTEM"], label: "No suitable vehicle found right now", type: "MATCHING_FAILED" },
  { from: ["PRICED", "PAYMENT_PENDING", "PAYMENT_CONFIRMED", "MATCHING", "DRIVER_ASSIGNED", "DRIVER_EN_ROUTE", "QUOTED"], to: "CANCELLED", action: "cancel", actors: ["CUSTOMER", "DRIVER", "ADMIN"], label: "Delivery cancelled", type: "CANCELLED" },
  { from: ["DELIVERED", "POD_CONFIRMED", "COMPLETED", "CANCELLED"], to: "DISPUTED", action: "dispute-open", actors: ["CUSTOMER", "ADMIN"], label: "Dispute opened", type: "DISPUTE_OPENED" },
];

export function canTransition(state: string, action: string, actor: Role): TransitionRule | null {
  return (
    TRANSITIONS.find((t) => t.action === action && t.from.includes(state as ShipmentState) && t.actors.includes(actor)) ?? null
  );
}

// Customer-facing status progression shown in timelines
export const CUSTOMER_TIMELINE: { key: string; label: string }[] = [
  { key: "PAYMENT_CONFIRMED", label: "Booking confirmed" },
  { key: "DRIVER_ASSIGNED", label: "Driver assigned" },
  { key: "DRIVER_ACCEPTED", label: "Driver accepted" },
  { key: "DRIVER_ARRIVED", label: "Driver arrived" },
  { key: "CARGO_LOADED", label: "Cargo loaded" },
  { key: "TRIP_STARTED", label: "In transit" },
  { key: "ARRIVING", label: "Approaching destination" },
  { key: "COMPLETED", label: "Delivered" },
];

export const ACTIVE_STATES = [
  "PAYMENT_CONFIRMED", "MATCHING", "DRIVER_ASSIGNED", "DRIVER_EN_ROUTE",
  "DRIVER_ARRIVED", "LOADING", "LOADED", "IN_TRANSIT", "ARRIVING", "DELIVERED", "POD_CONFIRMED",
];

export const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft", PRICED: "Priced", PAYMENT_PENDING: "Awaiting payment",
  PAYMENT_CONFIRMED: "Payment confirmed", MATCHING: "Finding vehicle",
  QUOTED: "Collecting quotes",
  DRIVER_ASSIGNED: "Driver assigned", DRIVER_EN_ROUTE: "Driver en route",
  DRIVER_ARRIVED: "Driver arrived", LOADING: "Loading", LOADED: "Cargo loaded",
  IN_TRANSIT: "In transit", ARRIVING: "Arriving", DELIVERED: "Unloading",
  POD_CONFIRMED: "Delivery confirmed", COMPLETED: "Delivered",
  CANCELLED: "Cancelled", NO_DRIVERS: "No vehicle available", DISPUTED: "Disputed",
};

export function shipmentProgress(status: string): number {
  const order = ["MATCHING", "DRIVER_ASSIGNED", "DRIVER_EN_ROUTE", "DRIVER_ARRIVED", "LOADING", "LOADED", "IN_TRANSIT", "ARRIVING", "DELIVERED", "POD_CONFIRMED", "COMPLETED"];
  const i = order.indexOf(status);
  return i < 0 ? 0 : Math.round(((i + 1) / order.length) * 100);
}
