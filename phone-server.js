// phone-server.js - Working Version
const express = require('express');
const twilio = require('twilio');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// YOUR GOOGLE SCRIPT URL - From your Wix form
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwXUshIdn0IWO90RR9Ydp94SHHLu59pTEz59HSfP_A3Iw2bg2yHnE6iMJsSENbYtpzY/exec";

// This answers the phone
app.post('/voice', (req, res) => {
    console.log('📞 Phone call received!');
    
    const twiml = new twilio.twiml.VoiceResponse();
    const gather = twiml.gather({
        input: 'speech dtmf',
        timeout: 3,
        numDigits: 1,
        action: '/menu',
        method: 'POST'
    });
    
    gather.say('Welcome to Blu Royal Rides. Press 1 for One Way trip. Press 2 for Hourly service.');
    
    res.type('text/xml');
    res.send(twiml.toString());
});

// Handle menu choices
app.post('/menu', (req, res) => {
    const { Digits, From } = req.body;
    console.log(`📱 Customer ${From} selected: ${Digits}`);
    
    const twiml = new twilio.twiml.VoiceResponse();
    
    if (Digits === '1') {
        twiml.say('You selected One Way service. Thank you for calling Blu Royal Rides. Please visit our website to complete your booking, or we will call you back shortly. Goodbye.');
    } else if (Digits === '2') {
        twiml.say('You selected Hourly service. Thank you for calling Blu Royal Rides. Please visit our website to complete your booking, or we will call you back shortly. Goodbye.');
    } else {
        twiml.say('Invalid selection. Goodbye.');
    }
    
    twiml.hangup();
    
    res.type('text/xml');
    res.send(twiml.toString());
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'online',
        message: 'Blu Royal Rides Phone System',
        time: new Date().toISOString()
    });
});

// Simple GET test for voice
app.get('/voice', (req, res) => {
    res.send('Voice endpoint is working. Use POST method for calls.');
});

const PORT = 3000;
app.listen(PORT, () => {
    console.log('═══════════════════════════════════════════');
    console.log('🚗 BLU ROYAL RIDES PHONE SYSTEM');
    console.log('═══════════════════════════════════════════');
    console.log(`📞 POST /voice - Answer phone calls`);
    console.log(`🏥 GET  /health - Check status`);
    console.log(`🌐 http://localhost:${PORT}`);
    console.log('═══════════════════════════════════════════');
});
