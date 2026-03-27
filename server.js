const express = require('express');
const twilio = require('twilio');
const axios = require('axios');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Your Google Script URL from Wix
const GOOGLE_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwXUshIdn0IWO90RR9Ydp94SHHLu59pTEz59HSfP_A3Iw2bg2yHnE6iMJsSENbYtpzY/exec";

// Pricing formulas
const BASE_FARE = 125.00;
const HOURLY_RATE = 125.00;

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
            callSid: CallSid,
            step: 'pickup'
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
    call.step = 'destination';
    activeCalls.set(CallSid, call);
    
    // Now ask for destination
    const twiml = new twilio.twiml.VoiceResponse();
    const gather = twiml.gather({
        input: 'speech',
        timeout: 10,
        action: '/get-destination',
        method: 'POST'
    });
    gather.say('Please tell me your destination.');
    
    res.type('text/xml');
    res.send(twiml.toString());
});

// ============================================
// GET DESTINATION
// ============================================
app.post('/get-destination', (req, res) => {
    console.log('Destination:', req.body.SpeechResult);
    
    const SpeechResult = req.body.SpeechResult;
    const CallSid = req.body.CallSid;
    const call = activeCalls.get(CallSid);
    
    if (!SpeechResult) {
        const twiml = new twilio.twiml.VoiceResponse();
        const gather = twiml.gather({
            input: 'speech',
            timeout: 10,
            action: '/get-destination',
            method: 'POST'
        });
        gather.say('Please say your destination again.');
        res.type('text/xml');
        return res.send(twiml.toString());
    }
    
    call.destination = SpeechResult;
    
    // Calculate price (using 25 miles as example)
    const distance = 25;
    let mileageRate = 1.80;
    if (distance > 150) mileageRate = 2.80;
    else if (distance > 100) mileageRate = 2.40;
    else if (distance > 50) mileageRate = 2.00;
    
    const total = BASE_FARE + (distance * mileageRate);
    call.price = total;
    call.step = 'name';
    activeCalls.set(CallSid, call);
    
    // Ask for name
    const twiml = new twilio.twiml.VoiceResponse();
    const gather = twiml.gather({
        input: 'speech',
        timeout: 10,
        action: '/get-name',
        method: 'POST'
    });
    gather.say(`The estimated fare is $${total.toFixed(2)}. Please tell me your full name.`);
    
    res.type('text/xml');
    res.send(twiml.toString());
});

// ============================================
// GET NAME
// ============================================
app.post('/get-name', (req, res) => {
    console.log('Name:', req.body.SpeechResult);
    
    const SpeechResult = req.body.SpeechResult;
    const CallSid = req.body.CallSid;
    const call = activeCalls.get(CallSid);
    
    if (!SpeechResult) {
        const twiml = new twilio.twiml.VoiceResponse();
        const gather = twiml.gather({
            input: 'speech',
            timeout: 10,
            action: '/get-name',
            method: 'POST'
        });
        gather.say('Please tell me your full name.');
        res.type('text/xml');
        return res.send(twiml.toString());
    }
    
    call.customerName = SpeechResult;
    call.step = 'email';
    activeCalls.set(CallSid, call);
    
    // Ask for email
    const twiml = new twilio.twiml.VoiceResponse();
    const gather = twiml.gather({
        input: 'speech',
        timeout: 10,
        action: '/get-email',
        method: 'POST'
    });
    gather.say('Please tell me your email address to send the invoice.');
    
    res.type('text/xml');
    res.send(twiml.toString());
});

// ============================================
// GET EMAIL AND COMPLETE BOOKING
// ============================================
app.post('/get-email', async (req, res) => {
    console.log('Email:', req.body.SpeechResult);
    
    const SpeechResult = req.body.SpeechResult;
    const CallSid = req.body.CallSid;
    const call = activeCalls.get(CallSid);
    
    if (!SpeechResult) {
        const twiml = new twilio.twiml.VoiceResponse();
        const gather = twiml.gather({
            input: 'speech',
            timeout: 10,
            action: '/get-email',
            method: 'POST'
        });
        gather.say('Please tell me your email address.');
        res.type('text/xml');
        return res.send(twiml.toString());
    }
    
    const email = SpeechResult.toLowerCase().replace(/\s/g, '');
    call.customerEmail = email;
    const bookingCode = generateBookingCode();
    
    // Send to Google Sheet
    try {
        const bookingData = {
            bookingCode: bookingCode,
            serviceType: call.serviceType === 'oneWay' ? 'One Way' : 'Hourly',
            fromAddress: call.pickup || 'Not specified',
            toAddress: call.destination || 'Not specified',
            dateTime: new Date().toLocaleString(),
            totalFare: call.price.toFixed(2),
            customerName: call.customerName,
            customerEmail: call.customerEmail,
            customerPhone: call.phoneNumber,
            passengers: '1',
            luggage: '0'
        };
        
        const params = new URLSearchParams(bookingData);
        await axios.get(`${GOOGLE_SCRIPT_URL}?${params.toString()}`);
        console.log(`✅ Booking ${bookingCode} sent to Google Sheet`);
    } catch (error) {
        console.error('Google Sheet error:', error.message);
    }
    
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say(`Thank you ${call.customerName}! Your booking ${bookingCode} is confirmed. Total fare is $${call.price.toFixed(2)}. A Square invoice will be sent to your email. Thank you for choosing Blu Royal Rides!`);
    twiml.hangup();
    
    console.log(`✅ Booking complete: ${bookingCode}`);
    
    res.type('text/xml');
    res.send(twiml.toString());
    
    activeCalls.delete(CallSid);
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
