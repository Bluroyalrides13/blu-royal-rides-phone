// test-server.js - Super Simple Test
const express = require('express');
const app = express();

app.get('/health', (req, res) => {
    res.send('✅ Server is working!');
});

app.get('/voice', (req, res) => {
    res.send('Voice endpoint works!');
});

app.post('/voice', (req, res) => {
    res.send('POST to voice works!');
});

app.listen(3000, () => {
    console.log('Server running on port 3000');
    console.log('Test: http://localhost:3000/health');
});
