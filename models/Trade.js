const mongoose = require('mongoose');

const tradeSchema = new mongoose.Schema({
  entryPrice: {
    type: Number,
  },
  exitPrice: {
    type: Number,
  },
  direction: {
    type: String,
    enum: ['BUY', 'SELL'],
  },
  stopLoss: {
    type: Number
  },
  target: {
    type: Number,
  },
  tradedQuantity: {
    type: Number,
    default: 50
  },
  currentStatus: {
    type: String,
    enum: ['PENDING', 'COMPLETED'],
    default: 'PENDING'
  },
  tradeStatus: {
    type: String,
    enum: ['OPEN', 'WINNER', 'LOSER'],
    default: 'OPEN'
  },
  profitLoss: {
    type: Number,
    default: 0
  },
  entryTime: {
    type: Date,
    default: Date.now
  },
  exitTime: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});


const Trade = mongoose.model('Trade', tradeSchema);

module.exports = Trade;