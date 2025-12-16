const { Server } = require("socket.io");
const Trade = require('../models/Trade'); // Import Trade model
const { connectBinance } = require("../services/binance.ws");
require('dotenv').config();

let io;

const initSocket = (httpServer) => {
io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONT_END,
    methods: ["GET", "POST"],
    credentials: true,
  },
});

  connectBinance(io);
  io.on("connection", (socket) => {
    console.log("Socket connected:", socket.id);
    broadcastTradeDetails(io, socket);
    socket.on("disconnect", () => {
      console.log("Socket disconnected:", socket.id);
    });
  });

  setInterval(() => {
    broadcastTradeDetails(io); // Broadcast to all
  }, 2000);

  return io;
};

/**
 * @param {Server} io 
 * @param {Socket} [socket] -
 */
async function broadcastTradeDetails(io, socket = null) {
  try {
    const totalTrades = await Trade.countDocuments();
    const winningTrades = await Trade.countDocuments({ tradeStatus: 'WINNER' });
    const losingTrades = await Trade.countDocuments({ tradeStatus: 'LOSER' });
    const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
    const totalLose = totalTrades > 0 ? (losingTrades / totalTrades) * 100 : 0;
    const pending_orders = await Trade.findOne({ currentStatus: 'OPEN' }).select("entryPrice exitPrice direction stopLoss target currentStatus tradeStatus signalType entryTime")
    const most_buy_direction = await Trade.countDocuments({ direction: 'BUY' });
    const most_sell_direction = await Trade.countDocuments({ direction: 'SELL' });

    const details = {
      totalTrades,
      winningTrades,
      losingTrades,
      winRate: parseFloat(winRate.toFixed(2)),
      totalLose: parseFloat(totalLose.toFixed(2)),
      pending_orders,
      most_buy_direction,
      most_sell_direction
    };

    const emitter = socket || io; 
    emitter.emit('tradeDetails', details);
  } catch (error) {
    console.error('Error broadcasting trade details:', error);
  }
}

module.exports = { initSocket, getIO: () => io };
