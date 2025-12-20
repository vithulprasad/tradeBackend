import mongoose from 'mongoose';

const SignalSchema = new mongoose.Schema(
  {
    signal:{
       type: String,
    },
    strength: {
      type: String,
      required: true,
    },
    price: {
      type: Number,
      required: true
    },
    signalTime: {
      type: Date,
      required: true,
      default: Date.now,
      index: true
    },
    notified: {
      type: Boolean,
      default: false
    },  
    confidence:{
      type: Number,
      required: true
    },
    cisd:{
      type:String
    },
    cisdLevel:{
      type:String
    },
    trend:{
      type:String
    },
    bullishSweep:{
      type:String
    },
    bearishSweep:{
      type:String
    },
    swingHigh:{
      type:String
    },
    swingLow:{
      type:String
    }
  },
  {
    timestamps: true
  }
);

export default mongoose.model('Signal', SignalSchema);
