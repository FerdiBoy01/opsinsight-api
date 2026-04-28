const express = require('express');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const fsPromises = require('fs').promises; 
const fsSync = require('fs'); 
const path = require('path'); 
const sharp = require('sharp'); // 👈 IMPORT SHARP UNTUK KOMPRESI GAMBAR
const cameraRoutes = require('./routes/cameraRoutes');
const Camera = require('./models/Camera');
require('dotenv').config();


app.use(cors({ origin: '*' }));
const app = express();
const PORT = 3000;

// ==========================================
// STATE GLOBAL UNTUK SAKLAR AI
// ==========================================
let isAiActive = true;

// ==========================================
// 🧠 MEMORI ANTI-SPAM (DEDUPLICATION) 🔥
// ==========================================
const lastAlertCache = {}; 
const COOLDOWN_MS = 10000; // 10 DETIK COOLDOWN (Bisa diubah, misal 30000 untuk 30 detik)

const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fsSync.existsSync(uploadDir)) {
    fsSync.mkdirSync(uploadDir, { recursive: true });
}

app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// Koneksi Database
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log("🔥 MongoDB Cloud Connected!"))
  .catch(err => console.log("Gagal konek:", err));
  
const incidentSchema = new mongoose.Schema({
    timestamp: { type: Date, default: Date.now, index: true }, 
    type: String,
    detail: String,
    worker_status: String,
    zone: { type: String, default: 'Area Tidak Diketahui', index: true }, 
    image_url: { type: String, default: '' } 
});

const Incident = mongoose.model('Incident', incidentSchema);

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

app.use(cors());
// LIMIT DITAMBAH JADI 50mb JAGA-JAGA AI NGIRIM GAMBAR MENTAH GEDE
app.use(express.json({ limit: '50mb' })); 
app.use('/', cameraRoutes);

// ==========================================
// ENDPOINT SAKLAR AI
// ==========================================
app.get('/api/config', (req, res) => {
    res.json({ ai_active: isAiActive });
});

app.post('/api/config/toggle-ai', (req, res) => {
    isAiActive = !isAiActive;
    console.log(`\n⚙️ [SYSTEM COMMAND] Mode AI diubah menjadi: ${isAiActive ? 'ON (Mendeteksi)' : 'OFF (Normal CCTV)'}`);
    res.json({ ai_active: isAiActive });
});

// ==========================================
// 🚀 ENDPOINT PENERIMA SENSOR DARI PYTHON (AI)
// DILENGKAPI ANTI-SPAM & COMPRESSOR 
// ==========================================
app.post('/api/alerts', async (req, res) => {
    const alertData = req.body;
    let finalImageUrl = '';

    try {
        // Ambil nama kamera aktif untuk dijadikan kunci Anti-Spam
        const kameraAktif = await Camera.findOne({ isActive: true }).lean();
        const namaLokasi = kameraAktif ? kameraAktif.name : 'Area Tidak Diketahui';

        // 🥇 1. FILTERING: KIRIM HANYA SAAT PENTING
        if (alertData.detail.includes('Compliant') || alertData.detail === 'Idle') {
            // Simpan log, TAPI JANGAN SIMPAN GAMBARNYA BIAR HEMAT STORAGE!
            const newIncident = new Incident({
                type: alertData.type,
                detail: alertData.detail,
                worker_status: alertData.worker_status,
                timestamp: alertData.timestamp * 1000, 
                image_url: '', // Gambar kosong
                zone: namaLokasi
            });
            const savedIncident = await newIncident.save();
            io.emit('new_safety_alert', savedIncident);
            return res.status(200).json({ message: 'Log Aman (Sesuai SOP) diterima tanpa gambar.' });
        }

        // 🥇 3. DEDUPLICATE (ANTI-SPAM EVENT SAMA)
        const cacheKey = `${namaLokasi}_${alertData.detail}`;
        const now = Date.now();

        if (lastAlertCache[cacheKey] && (now - lastAlertCache[cacheKey] < COOLDOWN_MS)) {
            // print log kecil aja biar terminal ga penuh
            // console.log(`🛡️ [ANTI-SPAM] Mengabaikan ${alertData.detail} (Sedang Cooldown)`);
            return res.status(200).json({ message: 'Spam dicegah oleh sistem.' });
        }
        
        // Catat waktu pelanggaran ini masuk
        lastAlertCache[cacheKey] = now;

        // 🥇 2. COMPRESS IMAGE (WAJIB)
        if (alertData.image_b64) {
            try {
                const fileName = `incident_${Date.now()}_${Math.floor(Math.random() * 1000)}.jpg`;
                const filePath = path.join(uploadDir, fileName);
                const base64Data = alertData.image_b64.replace(/^data:image\/\w+;base64,/, "");
                
                // Ubah base64 jadi Buffer
                const imgBuffer = Buffer.from(base64Data, 'base64');
                
                // 🪄 MAGIC KOMPRESI PAKAI SHARP
                await sharp(imgBuffer)
                    .resize({ width: 640 }) // Mentok lebar 640px
                    .jpeg({ quality: 65 })  // Kualitas 65% (Kecil ukurannya, tapi masih jelas dibaca)
                    .toFile(filePath);      // Langsung simpan ke folder uploads
                
                finalImageUrl = `http://localhost:3000/uploads/${fileName}`;
                console.log(`🗜️ [COMPRESS] Gambar dikecilkan dan disimpan: ${fileName}`);
            } catch (error) {
                console.error('❌ [SHARP ERROR] Gagal mengkompres/menyimpan foto:', error);
            }
        }

        // SIMPAN KE DATABASE
        const newIncident = new Incident({
            type: alertData.type,
            detail: alertData.detail,
            worker_status: alertData.worker_status,
            timestamp: alertData.timestamp * 1000, 
            image_url: finalImageUrl,
            zone: namaLokasi
        });
        
        const savedIncident = await newIncident.save();
        console.log(`🚨 [DANGER ALERT] ${alertData.detail} | LOKASI: ${namaLokasi}`);
        
        // Broadcast ke frontend
        io.emit('new_safety_alert', savedIncident);
        res.status(200).json({ message: 'Payload diterima & Insiden dicatat' });

    } catch (err) {
        console.error('❌ [DB ERROR] Gagal simpan ke MongoDB:', err);
        res.status(500).json({ message: 'Internal Server Error' });
    }
});

app.get('/api/incidents', async (req, res) => {
    try {
        const history = await Incident.find()
            .sort({ timestamp: -1 })
            .limit(300) 
            .lean(); 
            
        res.json(history);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

server.listen(PORT, () => {
    console.log(`\n========================================`);
    console.log(`🚀 [AI-K3 CORE] Backend Siap pada Port ${PORT}`);
    console.log(`🛡️ [SYSTEM] Anti-Spam (10s) & Image Compression Aktif`);
    console.log(`========================================\n`);
});