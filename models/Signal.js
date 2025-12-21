const mongoose = require("mongoose");

const SignalSchema = new mongoose.Schema(
  {
    signal: String,
    strength: { type: String, required: true },
    price: { type: Number, required: true },
    signalTime: {
      type: Date,
      default: Date.now,
      index: true
    },
    notified: { type: Boolean, default: false },
    confidence: { type: Number, required: true },

    cisd: Boolean,
    cisdLevel: String,
    trend: String,
    bullishSweep: Boolean,
    bearishSweep: Boolean,
    swingHigh: Number,
    swingLow: Number
  },
  { timestamps: true }
);

module.exports = mongoose.model('Signal', SignalSchema);


