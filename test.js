const express = require('express');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// This handles ALL requests to /voice
app.all('/voice', (req, res) => {
    console.log('===== CALL RECEIVED =====');
    console.log('Method:', req.method);
    console.log('Time:', new Date().toISOString());
    
    // Simple XML response
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say>Hello! This is Blu Royal Rides. Your phone system is working!</Say>
    <Hangup/>
</Response>`;
    
    res.set('Content-Type', 'text/xml');
    res.send(xml);
});

// Health check
app.get('/health', (req, res) => {
    res.send('OK');
});

// Start server
app.listen(3000, () => {
    console.log('===== SERVER STARTED =====');
    console.log('Port: 3000');
    console.log('Health: http://localhost:3000/health');
    console.log('Voice: http://localhost:3000/voice');
});
