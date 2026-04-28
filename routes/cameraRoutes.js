// backend/routes/cameraRoutes.js
const express = require('express');
const router = express.Router();
const Camera = require('../models/Camera');

// 1. Ambil semua data kamera
router.get('/api/cameras', async (req, res) => {
    try {
        const cameras = await Camera.find();
        res.json(cameras);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 2. Tanya AI: "Kamera mana yang aktif?"
router.get('/api/cameras/active', async (req, res) => {
    try {
        const activeCam = await Camera.findOne({ isActive: true });
        if (activeCam) {
            res.json(activeCam);
        } else {
            res.status(404).json({ error: "Tidak ada kamera aktif" });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3. Tambah kamera baru
router.post('/api/cameras', async (req, res) => {
    try {
        // Kalau ini kamera pertama, langsung jadikan aktif
        const totalCameras = await Camera.countDocuments();
        const newCam = new Camera({
            name: req.body.name,
            url: req.body.url,
            isActive: totalCameras === 0 
        });
        const savedCam = await newCam.save();
        res.json(savedCam);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 4. TOMBOL PENGGANTI KAMERA
router.post('/api/cameras/switch/:id', async (req, res) => {
    try {
        // Matikan semua kamera dulu (Mongoose syntax)
        await Camera.updateMany({}, { isActive: false });
        // Nyalakan yang dipilih
        await Camera.findByIdAndUpdate(req.params.id, { isActive: true });
        res.json({ message: "Sinyal pindah kamera dikirim ke AI!" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// 5. HAPUS KAMERA
router.delete('/api/cameras/:id', async (req, res) => {
    try {
        await Camera.findByIdAndDelete(req.params.id);
        res.json({ message: "Kamera berhasil dihapus!" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;