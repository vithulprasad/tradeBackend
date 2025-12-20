const { Server } = require("socket.io");
const Trade = require("../models/Trade");
const { connectBinance } = require("../services/binance.ws");
require("dotenv").config();

let io;

const initSocket = (httpServer) => {
  io = new Server(httpServer, {
    cors: {
      origin: process.env.FRONT_END,
      methods: ["GET", "POST"],
      credentials: true
    }
  });

  io.on("connection", async (socket) => {
    console.log("Socket connected:", socket.id);

    // Send initial trade stats to new client
    const details = await getTradeDetails();
    socket.emit("tradeDetails", details);

    socket.on("disconnect", () => {
      console.log("Socket disconnected:", socket.id);
    });
  });

  // 🔁 Broadcast trade stats to all clients
  setInterval(async () => {
    const details = await getTradeDetails();
    io.emit("tradeDetails", details);
  }, 2000);

  // 🔁 Binance live price broadcast (separate loop)
  setInterval(() => {
    connectBinance(io);
  }, 2000);

  return io;
};

/**
 * Fetch trade stats (NO SOCKET LOGIC HERE)
 */
async function getTradeDetails() {
  try {
    const totalTrades = await Trade.countDocuments();
    const winningTrades = await Trade.countDocuments({ tradeStatus: "WINNER" });
    const losingTrades = await Trade.countDocuments({ tradeStatus: "LOSER" });

    const winRate =
      totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

    const totalLose =
      totalTrades > 0 ? (losingTrades / totalTrades) * 100 : 0;

    const pending_orders = await Trade.findOne({ tradeStatus: "OPEN" })
      .select(
        "entryPrice exitPrice direction stopLoss target currentStatus tradeStatus signalType entryTime"
      )
      .lean();

    const most_buy_direction = await Trade.countDocuments({ direction: "BUY" });
    const most_sell_direction = await Trade.countDocuments({ direction: "SELL" });

    return {
      totalTrades,
      winningTrades,
      losingTrades,
      winRate: Number(winRate.toFixed(2)),
      totalLose: Number(totalLose.toFixed(2)),
      pending_orders,
      most_buy_direction,
      most_sell_direction
    };
  } catch (error) {
    console.error("❌ Error fetching trade details:", error);
    return null;
  }
}

module.exports = {
  initSocket,
  getIO: () => io,
  getTradeDetails
};
