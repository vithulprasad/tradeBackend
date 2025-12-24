const axios = require("axios");
const CISDIndicator = require("./Indicator.js");
const SignalModel = require("../models/Signal");
const TradeModel = require("../models/Trade");

const ohlcBuffer = [];

const activeTrades = new Map();

const Indicator = new CISDIndicator({
  tolerance: 0.65,
  swingPeriod: 6,
  expiryBars: 50,
  liquidityLookback: 5,
});

let pollingInterval = null;
let lastCandleTime = null;

const EnteringTrade = async () => {
  try {
    const existingTrade = await TradeModel.findOne({
      currentStatus: "PENDING",
    });

    if (existingTrade) return;
    const latestSignal = await SignalModel.findOne({ tradeId: null }).sort({
      signalTime: -1,
    });

    if (!latestSignal) return;

    const entryPrice = latestSignal.price;
    const isBuy = latestSignal.signal === "BUY";

    const target = isBuy
      ? entryPrice * 1.007 // +0.7%
      : entryPrice * 0.993; // -0.7%

    const stopLoss = isBuy
      ? entryPrice * 0.995 // -0.5%
      : entryPrice * 1.005; // +0.5%

    const trade = await TradeModel.create({
      entryPrice: +entryPrice.toFixed(2),
      target: +target.toFixed(2),
      stopLoss: +stopLoss.toFixed(2),
      direction: isBuy ? "LONG" : "SHORT",
      tradedQuantity: 1,
      currentStatus: "PENDING",
      tradeStatus: "OPEN",
      entryTime: new Date(),
    });

    await SignalModel.updateOne(
      { _id: latestSignal._id },
      { $set: { tradeId: trade._id } }
    );

    console.log("✅ Trade created:", trade._id);
  } catch (error) {
    console.error("❌ EnteringTrade error:", error.message);
  }
};

const UpdatingTrade = async (current_price) => {
  const existingTrade = await TradeModel.findOne({
    currentStatus: "PENDING",
  });

  if (!existingTrade) return;

  if (current_price > existingTrade.target) {
    existingTrade.tradedQuantity = 1;
    existingTrade.currentStatus = "COMPLETED";
    existingTrade.tradeStatus = "WINNER";
    existingTrade.profitLoss = 2;
    existingTrade.exitTime = new Date();

    await existingTrade.save();
    return true;
  }

  if (current_price < existingTrade.stopLoss) {
    existingTrade.tradedQuantity = 1;
    existingTrade.currentStatus = "COMPLETED";
    existingTrade.tradeStatus = "LOSER";
    existingTrade.profitLoss = 1;
    existingTrade.exitTime = new Date();

    await existingTrade.save();
    return true;
  }

  return false;
};

const connectBinance = async () => {
  try {
    const res = await fetch(
      "https://min-api.cryptocompare.com/data/v2/histominute?fsym=BTC&tsym=USD&limit=30",
      {
        headers: {
          authorization:
            "Apikey 952315b18589dc2819e120faa9cea1159fb5b874ca625c2341d8f093531d8f1e",
        },
      }
    );
    const json = await res.json();
    const candles = json?.Data?.Data || [];
    if (!candles.length) {
      console.log("❌ No candle data received");
      return;
    }
    const latestCandle = candles[candles.length - 1];
    const latestPrice = latestCandle.close;
    const res_details = await UpdatingTrade(latestPrice);
    console.log(res_details);
    const ohlcData = candles.map((c) => ({
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    const latest = ohlcData[ohlcData.length - 1];
    const results = Indicator.calculate(ohlcData);
    if (!results?.length) return;
    const last = results[results.length - 1];
    let signal = "NEUTRAL";
    if (last.bullishSweep) signal = "BUY";
    else if (last.bearishSweep) signal = "SELL";
    if (signal === "NEUTRAL" && !last.cisd) {
      console.log("⚪ No valid signal – skipped");
      return;
    }
    const savedSignal = await SignalModel.create({
      signal,
      strength: last.strength || "MEDIUM",
      price: latest.close, 
      confidence: last.confidence ?? 0.7,
      cisd: last.cisd,
      cisdLevel: last.cisdLevel,
      trend: last.trend,
      bullishSweep: last.bullishSweep,
      bearishSweep: last.bearishSweep,
      swingHigh: last.swingHigh,
      swingLow: last.swingLow,
    });

    EnteringTrade()
    console.log("✅ Signal saved:", savedSignal._id);
  } catch (err) {
    console.error("❌ connectBinance error:", err.message);
  }
};

const getBufferStatus = () => {
  return {
    size: ohlcBuffer.length,
    minRequired: Indicator.len * 2 + 10,
    ready: ohlcBuffer.length >= Indicator.len * 2 + 10,
    firstCandle: ohlcBuffer[0]?.timestamp || null,
    lastCandle: ohlcBuffer[ohlcBuffer.length - 1]?.timestamp || null,
    lastCandleTime: lastCandleTime,
    isPolling: pollingInterval !== null,
  };
};

const calculateIndicator = () => {
  if (ohlcBuffer.length < indicator.len * 2 + 10) {
    return { error: "Not enough data", bufferStatus: getBufferStatus() };
  }

  const results = Indicator.calculate(ohlcBuffer);
  return results;
};

module.exports = {
  connectBinance,
  getBufferStatus,
  calculateIndicator,
  ohlcBuffer,
  activeTrades,
};
