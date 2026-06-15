import { describe, it, expect } from "vitest";
import { createClient } from "../db";
import {
  createWatchlist,
  listWatchlists,
  countWatchlists,
  getOwnedWatchlist,
  updateWatchlist,
  deleteWatchlist,
} from "../db/watchlists";
import { TIERS } from "../tiers";

function newClientId() {
  const uniq = `wl-${Date.now()}-${Math.floor(Math.random() * 1e9)}@test.local`;
  return createClient(uniq).id;
}

describe("watchlists DB layer", () => {
  it("creates and reads back a watchlist", () => {
    const cid = newClientId();
    const wl = createWatchlist(cid, "AI semis", ["NVDA", "AMD"], true);
    expect(wl.id).toMatch(/^wl_/);
    expect(wl.tickers).toEqual(["NVDA", "AMD"]);
    expect(wl.email_alerts).toBe(true);
    expect(getOwnedWatchlist(wl.id, cid)?.name).toBe("AI semis");
  });

  it("scopes by owner — another client cannot read it", () => {
    const owner = newClientId();
    const other = newClientId();
    const wl = createWatchlist(owner, "mine", ["AAPL"], true);
    expect(getOwnedWatchlist(wl.id, other)).toBeUndefined();
    expect(getOwnedWatchlist(wl.id, owner)).toBeDefined();
  });

  it("lists and counts per client", () => {
    const cid = newClientId();
    createWatchlist(cid, "a", ["MSFT"], true);
    createWatchlist(cid, "b", ["GOOG"], false);
    expect(countWatchlists(cid)).toBe(2);
    expect(listWatchlists(cid).length).toBe(2);
  });

  it("updates name/tickers/emailAlerts only for the owner", () => {
    const cid = newClientId();
    const wl = createWatchlist(cid, "old", ["NVDA"], true);
    expect(updateWatchlist(wl.id, "someone-else", { name: "x", tickers: ["AMD"], emailAlerts: false })).toBe(false);
    expect(updateWatchlist(wl.id, cid, { name: "new", tickers: ["AMD", "AVGO"], emailAlerts: false })).toBe(true);
    const updated = getOwnedWatchlist(wl.id, cid)!;
    expect(updated.name).toBe("new");
    expect(updated.tickers).toEqual(["AMD", "AVGO"]);
    expect(updated.email_alerts).toBe(false);
  });

  it("deletes only for the owner", () => {
    const cid = newClientId();
    const wl = createWatchlist(cid, "del", ["TSLA"], true);
    expect(deleteWatchlist(wl.id, "someone-else")).toBe(false);
    expect(deleteWatchlist(wl.id, cid)).toBe(true);
    expect(getOwnedWatchlist(wl.id, cid)).toBeUndefined();
  });
});

describe("watchlist tier config", () => {
  it("gates monitoring to subscription tiers", () => {
    expect(TIERS.free.watchlistMonitoring).toBe(false);
    expect(TIERS.payg.watchlistMonitoring).toBe(false);
    expect(TIERS.pro.watchlistMonitoring).toBe(true);
    expect(TIERS.starter.watchlistMonitoring).toBe(true);
    expect(TIERS.enterprise.watchlistMonitoring).toBe(true);
  });

  it("defines watchlist + ticker caps per tier (free tightest)", () => {
    expect(TIERS.free.maxWatchlists).toBe(1);
    expect(TIERS.free.maxWatchlistTickers).toBe(10);
    expect(TIERS.pro.maxWatchlistTickers).toBeGreaterThanOrEqual(TIERS.free.maxWatchlistTickers);
  });
});
