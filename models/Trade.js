const mongoose = require('mongoose');

const tradeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  symbol: {
    type: String,
    required: true,
    uppercase: true
  },
  entryPrice: {
    type: Number,
    required: true
  },
  exitPrice: {
    type: Number,
    default: null
  },
  direction: {
    type: String,
    enum: ['BUY', 'SELL'],
    required: true
  },
  stopLoss: {
    type: Number,
    required: true
  },
  target: {
    type: Number,
    required: true
  },
  tradedQuantity: {
    type: Number,
    required: true,
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
  signalType: {
    type: String,
    enum: ['STRONG_BULLISH', 'STRONG_BEARISH', 'NORMAL_BULLISH', 'NORMAL_BEARISH'],
    required: true
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

// Index for faster queries
tradeSchema.index({ currentStatus: 1, tradeStatus: 1 });
tradeSchema.index({ symbol: 1, entryTime: -1 });
tradeSchema.index({ createdAt: -1 });

// Virtual for trade duration
tradeSchema.virtual('duration').get(function() {
  if (this.exitTime) {
    return Math.floor((this.exitTime - this.entryTime) / 1000 / 60); // in minutes
  }
  return Math.floor((Date.now() - this.entryTime) / 1000 / 60);
});

// Method to calculate potential profit/loss
tradeSchema.methods.calculatePL = function(currentPrice) {
  if (this.direction === 'BUY') {
    return ((currentPrice - this.entryPrice) / this.entryPrice) * 100;
  } else {
    return ((this.entryPrice - currentPrice) / this.entryPrice) * 100;
  }
};

// Static method to get active trades
tradeSchema.statics.getActiveTrades = function() {
  return this.find({ currentStatus: 'PENDING', tradeStatus: 'OPEN' });
};

// Static method to get trade statistics
tradeSchema.statics.getStats = async function() {
  const stats = await this.aggregate([
    {
      $group: {
        _id: '$tradeStatus',
        count: { $sum: 1 },
        avgProfitLoss: { $avg: '$profitLoss' }
      }
    }
  ]);
  
  return stats;
};

const Trade = mongoose.model('Trade', tradeSchema);

module.exports = Trade;