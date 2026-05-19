const mongoose = require('mongoose');
const { mongoUri } = require('../config/env');

let isConnected = false;

async function connectMongo() {
  if (isConnected) return;
  mongoose.set('strictQuery', true);
  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 15000
  });
  isConnected = true;
}

module.exports = { connectMongo };

