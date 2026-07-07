// Row shapes of the native-cassa tables (scripts/migrations/2026-07-04-cassa.sql).
// Kept separate from src/lib/pos/types.ts on purpose: that module is the bridge
// to EXTERNAL tills; these are the CRM's own point-of-sale records.

import type { CassaPaymentMethod } from "./totals";
import type { MenuItemVariant } from "@/lib/types";

export type CassaOrderStatus = "open" | "paid" | "cancelled" | "void";
export type CassaChannel = "sala" | "asporto" | "delivery";
/** draft = in the shared cart (not fired yet); sent = fired with a comanda round. */
export type CassaItemStatus = "draft" | "sent" | "cancelled";

export interface CassaOrderRow {
  id: string;
  tenant_id: string;
  session_id: string | null;
  table_id: string | null;
  /** Display label snapshot: "Tavolo 4", "Banco", "Asporto"… survives table renames. */
  table_name: string;
  channel: CassaChannel;
  status: CassaOrderStatus;
  covers: number;
  /** Coperto per person, snapshotted from settings.cassa.cover_charge at creation. */
  cover_unit: number;
  discount_type: "percent" | "amount" | null;
  discount_value: number;
  subtotal: number;
  total: number;
  notes: string | null;
  opened_by: string | null;
  opened_by_name: string | null;
  opened_at: string;
  closed_at: string | null;
  receipt_number: number | null;
  receipt_year: number | null;
  receipt_date: string | null;
  void_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface CassaOrderItemRow {
  id: string;
  tenant_id: string;
  order_id: string;
  menu_item_id: string | null;
  name: string;
  /** Snapshot INCLUSIVE of the chosen variants' price deltas. */
  unit_price: number;
  qty: number;
  course: number;
  /** Which firing round (comanda) the line was sent with: 1 = first send, 2 = second… */
  comanda_no: number;
  notes: string | null;
  /** % IVA snapshotted at fire time (null on pre-v2 rows → treated as 10). */
  vat_rate: number | null;
  /** Prep station (reparto) snapshotted at fire time: "cucina", "bar"… */
  station: string | null;
  /** Chosen variants, for the ticket/receipt display (deltas already in unit_price). */
  variants: MenuItemVariant[];
  status: CassaItemStatus;
  created_at: string;
}

export interface CassaPaymentRow {
  id: string;
  tenant_id: string;
  order_id: string;
  method: CassaPaymentMethod;
  amount: number;
  /** Cash tendered by the guest (change = received − amount); null for non-cash. */
  received: number | null;
  created_by: string | null;
  created_at: string;
}

export interface CassaSessionRow {
  id: string;
  tenant_id: string;
  status: "open" | "closed";
  opened_at: string;
  opened_by: string | null;
  opened_by_name: string | null;
  opening_float: number;
  closed_at: string | null;
  closed_by: string | null;
  expected_cash: number | null;
  counted_cash: number | null;
  cash_difference: number | null;
  totals: Record<string, unknown>;
  notes: string | null;
  created_at: string;
}

/** An order joined with its lines (and payments once closed) — what the UI works with. */
export interface CassaOrderFull extends CassaOrderRow {
  items: CassaOrderItemRow[];
  payments?: CassaPaymentRow[];
}

/** A line the waiter is composing that hasn't been fired to the kitchen yet.
 * Lives only in client state; becomes a cassa_order_items row on "comanda". */
export interface CassaDraftLine {
  key: string;
  menu_item_id: string | null;
  name: string;
  /** Base price + the chosen variants' deltas. */
  unit_price: number;
  qty: number;
  course: number;
  notes: string | null;
  vat_rate: number;
  station: string | null;
  variants: MenuItemVariant[];
}
