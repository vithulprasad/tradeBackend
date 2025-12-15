
const express = require("express");
const http = require("http");
const mongoose = require('mongoose');
const { initSocket } = require("./socket");
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// It's highly recommended to use environment variables for sensitive data like your database connection string.
const MONGODB_URL = process.env.MONGODB_URL // ← put your real URL here

// The useNewUrlParser and useUnifiedTopology options are deprecated in recent versions of Mongoose and are no longer needed.
mongoose.connect(MONGODB_URL)
.then(() => console.log('✅ MongoDB Connected'))
.catch(err => console.error('❌ MongoDB Error', err));

initSocket(server);

server.listen(5000, () => {
  console.log("Server running on port 5000");
});























// // server.js
// const express = require('express');
// const http = require('http');
// const { Server } = require('socket.io');
// const WebSocket = require('ws');

// const app = express();
// const port = 5000;
// const mongoose = require('mongoose');

// // It's highly recommended to use environment variables for sensitive data like your database connection string.
// const MONGODB_URL = "mongodb+srv://chat_app:jG03EueQSr57OScG@cluster0.lcyzuyi.mongodb.net/?appName=Cluster0" // ← put your real URL here

// // The useNewUrlParser and useUnifiedTopology options are deprecated in recent versions of Mongoose and are no longer needed.
// mongoose.connect(MONGODB_URL)
// .then(() => console.log('✅ MongoDB Connected'))
// .catch(err => console.error('❌ MongoDB Error', err));

// // Create HTTP server and attach socket.io
// const server = http.createServer(app);
// const io = new Server(server, {
//   cors: {
//     origin: '*', // allow all origins (for testing)
//   }
// });

// // --- WebSocket Connection Handler ---
// io.on('connection', (socket) => {
//   console.log('✅ Client connected');
//   broadcastTradeDetails(socket); // Send initial details to the newly connected client
//   socket.on('disconnect', () => console.log('❌ Client disconnected'));
// });

// // Serve static files (frontend)
// app.use(express.static('public'));
// const tradeSchema = new mongoose.Schema({
//   symbol: String,
//   side: String,            // LONG / SHORT
//   entryPrice: Number,
//   exitPrice: Number,
//   pnl: Number,             // +profit / -loss
//   result: String,          // PROFIT / LOSS
//   entryTime: Date,
//   exitTime: Date
// });

// const Trade = mongoose.model('Trade', tradeSchema);

// // Connect to Binance WebSocket
// const ws = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@kline_1m');

// // --- Trading Strategy State & Constants ---
// let position = null; // 'LONG', 'SHORT', or null
// let entryPrice = 0;
// let entryTime = null;

// const STOP_LOSS_PCT = 1.0; // 1%
// const TAKE_PROFIT_PCT = 1.0; // 1%

// async function closeTrade(exitPrice, exitTime) {
//   const pnl =
//     position === 'LONG'
//       ? exitPrice - entryPrice
//       : entryPrice - exitPrice;

//   const result = pnl > 0 ? 'PROFIT' : 'LOSS';

//   const trade = new Trade({
//     symbol: 'BTCUSDT',
//     side: position,
//     entryPrice,
//     exitPrice,
//     pnl: Number(pnl.toFixed(2)),
//     result,
//     entryTime,
//     exitTime
//   });

//   await trade.save();

//   console.log(`📊 TRADE CLOSED | ${result}`);

//   position = null;
//   entryPrice = 0;
//   entryTime = null;
//   broadcastTradeDetails(); // Broadcast updated details to all clients
// }

// // --- WebSocket Message Handler with Trading Logic ---
// ws.on('message', async (data) => {
//   const message = JSON.parse(data);
//   const candle = message.k;

//   // Check if the candle is closed
//   if (!candle.x) {
//     return; // Candle is not closed yet, do nothing
//   }

//   const close = parseFloat(candle.c);
//   const open = parseFloat(candle.o);
//   const candleTime = new Date(candle.t);

//   const candleData = {
//     time: candleTime,
//     open: open,
//     high: parseFloat(candle.h),
//     low: parseFloat(candle.l),
//     close: close,
//     volume: parseFloat(candle.v)
//   };

//   console.log(candleData);

//   // Broadcast candle data to all connected clients
//   io.emit('candle', candleData);

//   // --- Trading Logic ---

//   // Check to close existing position
//   if (position === 'LONG') {
//     const sl = entryPrice * (1 - STOP_LOSS_PCT / 100);
//     const tp = entryPrice * (1 + TAKE_PROFIT_PCT / 100);

//     if (close <= sl || close >= tp) {
//       await closeTrade(close, candleTime);
//     }
//   } else if (position === 'SHORT') {
//     const sl = entryPrice * (1 + STOP_LOSS_PCT / 100);
//     const tp = entryPrice * (1 - TAKE_PROFIT_PCT / 100);

//     if (close >= sl || close <= tp) {
//       await closeTrade(close, candleTime);
//     }
//   }

//   // Check to open a new position if none exists
//   if (!position) {
//     const longSignal = close > open;  // Green candle
//     const shortSignal = close < open; // Red candle

//     if (longSignal) {
//       position = 'LONG';
//       entryPrice = close;
//       entryTime = candleTime;
//       console.log(`🚀 ENTERING LONG at ${entryPrice}`);
//     } else if (shortSignal) {
//       position = 'SHORT';
//       entryPrice = close;
//       entryTime = candleTime;
//       console.log(`🔻 ENTERING SHORT at ${entryPrice}`);
//     }
//   }
// });

// /**
//  * Calculates and broadcasts the latest trade statistics to clients.
//  * @param {Socket} [socket] - If provided, emits to a single socket. Otherwise, broadcasts to all.
//  */
// async function broadcastTradeDetails(socket) {
//   try {
//     const totalTrades = await Trade.countDocuments();
//     const winningTrades = await Trade.countDocuments({ result: 'PROFIT' });
//     const losingTrades = await Trade.countDocuments({ result: 'LOSS' });
//     const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;

//     const tradesForChart = await Trade.find({}).sort({ entryTime: 'asc' }).lean();

//     const details = {
//       totalTrades,
//       winningTrades,
//       losingTrades,
//       winRate: parseFloat(winRate.toFixed(2)),
//       chartData: tradesForChart,
//     };

//     const emitter = socket || io; // Use single socket if provided, otherwise broadcast to all
//     emitter.emit('tradeDetails', details);
//   } catch (error) {
//     console.error('Error broadcasting trade details:', error);
//   }
// }

// server.listen(port, () => {
//   console.log(`Server running on http://localhost:${port}`);
// });
