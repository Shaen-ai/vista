import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { topUpCurrencyForCountry } from "./vistaTokens";

describe("topUpCurrencyForCountry", () => {
  it("returns amd for Armenia", () => {
    assert.equal(topUpCurrencyForCountry("AM"), "amd");
    assert.equal(topUpCurrencyForCountry("am"), "amd");
    assert.equal(topUpCurrencyForCountry("  am  "), "amd");
  });

  it("returns usd for all other countries", () => {
    assert.equal(topUpCurrencyForCountry("US"), "usd");
    assert.equal(topUpCurrencyForCountry("RU"), "usd");
    assert.equal(topUpCurrencyForCountry("DE"), "usd");
    assert.equal(topUpCurrencyForCountry(""), "usd");
  });
});
