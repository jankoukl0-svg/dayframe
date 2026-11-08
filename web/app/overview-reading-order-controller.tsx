"use client";

/**
 * Reading is rendered into a stable React-owned portal target immediately after
 * .df2-overview-bottom-grid in HistoryController. Do not move that node in the
 * DOM: external reparenting races React reconciliation when periods change.
 */
export function OverviewReadingOrderController() {
  return null;
}
