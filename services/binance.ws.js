
const axios = require('axios');
const CISDIndicator =require('./Indicator.js')
const SignalModel = require('../models/Signal');
const ohlcBuffer = [];

const activeTrades = new Map();

const Indicator = new CISDIndicator({
  tolerance: 0.65,
  swingPeriod: 6,       
  expiryBars: 50,       
  liquidityLookback: 5 
});

let pollingInterval = null;
let lastCandleTime = null;


const connectBinance = async () => {
  try {
    const res = await fetch(
      "https://min-api.cryptocompare.com/data/v2/histominute?fsym=BTC&tsym=USD&limit=30",
      {
        headers: {
          authorization:
            "Apikey 952315b18589dc2819e120faa9cea1159fb5b874ca625c2341d8f093531d8f1e"
        }
      }
    );

    const json = await res.json();
    const candles = json?.Data?.Data || [];

    if (!candles.length) {
      console.log("❌ No candle data received");
      return;
    }

    // 🔹 Map OHLC
    const ohlcData = candles.map(c => ({
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close
    }));

    // ✅ MOST RECENT CANDLE
    const latest = ohlcData[ohlcData.length - 1];

    console.log("📊 Latest Candle:");
    console.log("Open :", latest.open);
    console.log("High :", latest.high);
    console.log("Low  :", latest.low);
    console.log("Close:", latest.close); // ✅ recent price

    // 🔹 Run Indicator
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
      price: latest.close, // ✅ recent candle close price
      confidence: last.confidence ?? 0.7,
      cisd: last.cisd,
      cisdLevel: last.cisdLevel,
      trend: last.trend,
      bullishSweep: last.bullishSweep,
      bearishSweep: last.bearishSweep,
      swingHigh: last.swingHigh,
      swingLow: last.swingLow
    });

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
    isPolling: pollingInterval !== null
  };
};

const calculateIndicator = () => {
  if (ohlcBuffer.length < indicator.len * 2 + 10) {
    return { error: 'Not enough data', bufferStatus: getBufferStatus() };
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


