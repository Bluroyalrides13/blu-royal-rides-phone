const express = require('express');
const twilio = require('twilio');
const axios = require('axios');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Your Google Script URL from Wix
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwXUshIdn0IWO90RR9Ydp94SHHLu59pTEz59HSfP_A3Iw2bg2yHnE6iMJsSENbYtpzY/exec";

// Store active calls
const activeCalls = new Map();

// Generate booking reference
function generateBookingCode() {
    const random = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `BRR-${random}`;
}

// ============================================
// VOICE ENDPOINT - Answers the phone
// ============================================
app.post('/voice', (req, res) => {
    console.log('Call received from:', req.body.From);
    
    const twiml = new twilio.twiml.VoiceResponse();
    
    const gather = twiml.gather({
        input: 'dtmf',
        timeout: 10,
        numDigits: 1,
        action: '/menu',
        method: 'POST'
    });
    
    gather.say('Welcome to Blu Royal Rides. Press 1 for One Way trip. Press 2 for Hourly service.');
    
    twiml.say('No selection received. Goodbye.');
    twiml.hangup();
    
    res.type('text/xml');
    res.send(twiml.toString());
});

// ============================================
// MENU HANDLER
// ============================================
app.post('/menu', (req, res) => {
    console.log('Menu choice:', req.body.Digits);
    
    const Digits = req.body.Digits;
    const From = req.body.From;
    const CallSid = req.body.CallSid;
    
    const twiml = new twilio.twiml.VoiceResponse();
    
    if (Digits === '1') {
        // Ask for pickup location
        const gather = twiml.gather({
            input: 'speech',
            timeout: 10,
            action: '/get-pickup',
            method: 'POST'
        });
        gather.say('Please tell me your pickup location.');
        
        activeCalls.set(CallSid, {
            phoneNumber: From,
            serviceType: 'oneWay',
            callSid: CallSid
        });
        
    } else if (Digits === '2') {
        twiml.say('Hourly service selected. Thank you for calling Blu Royal Rides!');
        twiml.hangup();
        
    } else {
        twiml.say('Invalid selection. Goodbye.');
        twiml.hangup();
    }
    
    res.type('text/xml');
    res.send(twiml.toString());
});

// ============================================
// GET PICKUP LOCATION
// ============================================
app.post('/get-pickup', (req, res) => {
    console.log('Pickup location:', req.body.SpeechResult);
    
    const SpeechResult = req.body.SpeechResult;
    const CallSid = req.body.CallSid;
    const call = activeCalls.get(CallSid);
    
    if (!SpeechResult) {
        const twiml = new twilio.twiml.VoiceResponse();
        const gather = twiml.gather({
            input: 'speech',
            timeout: 10,
            action: '/get-pickup',
            method: 'POST'
        });
        gather.say('Please say your pickup location again.');
        res.type('text/xml');
        return res.send(twiml.toString());
    }
    
    call.pickup = SpeechResult;
    activeCalls.set(CallSid, call);
    
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say(`Pickup location saved: ${SpeechResult}. Thank you for calling Blu Royal Rides!`);
    twiml.hangup();
    
    res.type('text/xml');
    res.send(twiml.toString());
});

// ============================================
// HEALTH CHECK
// ============================================
app.get('/health', (req, res) => {
    res.json({ status: 'online', time: new Date().toISOString() });
});

// ============================================
// ROOT ENDPOINT
// ============================================
app.get('/', (req, res) => {
    res.send('Blu Royal Rides Phone System is running!');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
