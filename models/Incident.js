const mongoose = require('mongoose');

const IncidentSchema = new mongoose.Schema({
  timestamp: { type: Date, default: Date.now },
  type: { type: String, required: true },
  detail: { type: String, required: true },
  zone: { type: String, default: 'Zone A' },
  status: { type: String, enum: ['active', 'resolved'], default: 'active' }
});

module.exports = mongoose.model('Incident', IncidentSchema);