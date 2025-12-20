const mongoose = require("mongoose");

const CandleSchema = new mongoose.Schema({
  symbol: { type: String, index: true },
  timeframe: { type: String, index: true },
  openTime: { type: Number, required: true },
  closeTime: Number,

  open: Number,
  high: Number,
  low: Number,
  close: Number,  
  volume: Number,

  source: String,
}, {
  timestamps: false, // 🔥 faster inserts
  versionKey: false
});

// 🔒 Prevent duplicates
CandleSchema.index(
  { symbol: 1, timeframe: 1, openTime: 1 },
  { unique: true }
);

module.exports = mongoose.model("Candle", CandleSchema);
