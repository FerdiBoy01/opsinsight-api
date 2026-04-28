// backend/models/Camera.js
const mongoose = require('mongoose');

const CameraSchema = new mongoose.Schema({
  name: { type: String, required: true },
  url: { type: String, required: true },
  isActive: { type: Boolean, default: false }
});

module.exports = mongoose.model('Camera', CameraSchema);